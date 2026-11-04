use anyhow::{bail, ensure, Result};
use native_bot::engine::{BotAction, Engine};
use riichienv_core::{parser::mjai_to_tid, replay::MjaiEvent, rule::GameRule};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, io::{self, BufRead, Read, Write}};
const PROTOCOL: &str = "akagi-native-worker-v1";
const COMMIT: &str = "1fb16453ae0b7b0a820510ea1d3dbd01b6939082";
const WEIGHT_SHA: &str = "33c20aaba3f349ef689df73b726224804dc4aaff99922093d8f30cc38d709a1d";
fn hash(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn emit(value: Value) -> Result<()> { let mut out = io::stdout().lock(); writeln!(out, "{}", value)?; out.flush()?; Ok(()) }
fn action(a: BotAction, seat: u8) -> Result<(Value, Option<Value>)> {
    let mut follow = None;
    let result = match a {
        BotAction::Dahai {pai, tsumogiri} => json!({"type":"dahai","actor":seat,"pai":pai,"tsumogiri":tsumogiri}),
        BotAction::Reach {pai} => { ensure!(!pai.is_empty(), "MISSING_REACH_DISCARD");
            // Upstream predicts from a clone; the exact drawn entity is resolved in caller.
            follow = Some(json!({"type":"dahai","actor":seat,"pai":pai,"tsumogiri":false}));
            json!({"type":"reach","actor":seat}) },
        BotAction::Pon {target,pai,consumed} => json!({"type":"pon","actor":seat,"target":target,"pai":pai,"consumed":consumed}),
        BotAction::Chi {target,pai,consumed} => json!({"type":"chi","actor":seat,"target":target,"pai":pai,"consumed":consumed}),
        BotAction::Daiminkan {target,pai,consumed} => json!({"type":"daiminkan","actor":seat,"target":target,"pai":pai,"consumed":consumed}),
        BotAction::Ankan {consumed} => json!({"type":"ankan","actor":seat,"consumed":consumed}),
        BotAction::Kakan {pai,consumed} => json!({"type":"kakan","actor":seat,"pai":pai,"consumed":consumed}),
        BotAction::Hora {target} => json!({"type":"hora","actor":seat,"target":target}),
        BotAction::Pass => json!({"type":"none"}),
        _ => bail!("UNSUPPORTED_ACTION"),
    }; Ok((result,follow))
}
fn replay(engine: &mut Engine, raw: &Value, audit: bool) -> Result<Value> {
    ensure!(raw["protocol"] == PROTOCOL, "PROTOCOL_MISMATCH");
    let id = raw["requestId"].as_str().ok_or_else(|| anyhow::anyhow!("INVALID_REQUEST"))?;
    ensure!(!id.is_empty() && id.len() <= 128, "INVALID_REQUEST");
    let seat = raw["seat"].as_u64().filter(|&s| s<4).ok_or_else(||anyhow::anyhow!("INVALID_SEAT"))? as u8;
    let events = raw["events"].as_array().ok_or_else(||anyhow::anyhow!("INVALID_EVENTS"))?;
    ensure!(events.len()>=3 && events.len()<=2000 && events[0]["type"]=="start_game" && events[1]["type"]=="start_kyoku", "INVALID_PREFIX");
    let last = events.last().unwrap();
    if last["type"]=="reach_accepted" { bail!("UNSUPPORTED_TRAILING_ANNOUNCEMENT"); }
    let last_kind=last["type"].as_str().unwrap_or("");
    let own = last["actor"]==seat;
    let response = ["dahai","kakan","ankan"].contains(&last_kind) && !own;
    ensure!(response || (own && ["tsumo","chi","pon","reach"].contains(&last_kind)), "NOT_DECISION_POINT");
    engine.reset(); engine.set_seat(seat); engine.set_rule(GameRule::default_mjsoul());
    for (index, original) in events.iter().enumerate() {
        let mut value=original.clone();
        let kind=original["type"].as_str().unwrap_or("");
        ensure!(["start_game","start_kyoku","tsumo","dahai","chi","pon","daiminkan","ankan","kakan","reach","reach_accepted","dora"].contains(&kind), "UNSUPPORTED_EVENT");
        let keys: &[&str] = match kind {
            "start_game"=> &["type","id","names"],
            "start_kyoku"=> &["type","bakaze","kyoku","honba","kyotaku","oya","scores","dora_marker","tehais"],
            "tsumo"=> &["type","actor","pai"],
            "dahai"=> &["type","actor","pai","tsumogiri"],
            "chi"|"pon"|"daiminkan"=> &["type","actor","target","pai","consumed"],
            "kakan"=> &["type","actor","pai","consumed"],
            "ankan"=> &["type","actor","consumed"],
            "reach"|"reach_accepted"=> &["type","actor"],
            "dora"=> &["type","dora_marker"], _=> &[]
        };
        ensure!(value.as_object().map_or(false,|o|o.keys().all(|k|keys.contains(&k.as_str()))),"UNSUPPORTED_EVENT_FIELD");
        ensure!((kind!="start_game" || index==0) && (kind!="start_kyoku" || index==1), "INVALID_PREFIX");
        for key in ["actor","target","oya"] { if let Some(n)=value.get(key) { ensure!(n.as_u64().map_or(false, |n|n<4), "INVALID_SEAT"); } }
        if kind=="start_game" { value["id"]=Value::String(seat.to_string()); }
        if kind=="start_kyoku" {
            ensure!(value["scores"].as_array().map_or(false,|x|x.len()==4), "INVALID_SCORES");
            let hands=value["tehais"].as_array().ok_or_else(||anyhow::anyhow!("INVALID_HANDS"))?;
            ensure!(hands.len()==4 && hands.iter().all(|h|h.as_array().map_or(false,|a|a.len()==13)), "INVALID_HANDS");
            for (s,hand) in hands.iter().enumerate() { for t in hand.as_array().unwrap() {
                let t=t.as_str().unwrap_or(""); ensure!(if s==seat as usize {mjai_to_tid(t).is_some()} else {t=="?"}, "HIDDEN_HAND_REJECTED");
            }}
        }
        if let Some(tile)=value.get("pai") { let t=tile.as_str().unwrap_or("");
            ensure!(mjai_to_tid(t).is_some() || (kind=="tsumo" && value["actor"]!=seat && t=="?"), "INVALID_TILE");
            if kind=="tsumo" && value["actor"]!=seat { ensure!(t=="?", "HIDDEN_DRAW_REJECTED"); }
        }
        if let Some(ts)=value.get("consumed") { let xs=ts.as_array().ok_or_else(||anyhow::anyhow!("INVALID_CONSUMED"))?;
            let count=match kind {"chi"|"pon"=>2,"ankan"=>4,_=>3};
            ensure!(xs.len()==count && xs.iter().all(|t|mjai_to_tid(t.as_str().unwrap_or("")).is_some()),"INVALID_CONSUMED");
        }
        if let Some(t)=value.get("dora_marker") { ensure!(mjai_to_tid(t.as_str().unwrap_or("")).is_some(), "INVALID_TILE"); }
        let event: MjaiEvent=serde_json::from_value(value).map_err(|_|anyhow::anyhow!("INVALID_EVENT"))?;
        ensure!(!matches!(event,MjaiEvent::Other), "UNSUPPORTED_EVENT");
        engine.feed_checked(event);
    }
    let decision=engine.decide()?;
    let (mut a, mut follow)=match decision { Some(d)=>action(d.action,seat)?, None if response => { let (_,mask,_)=engine.snapshot()?; ensure!(mask.iter().all(|&b|b==0),"MISSING_LEGAL_DECISION"); (json!({"type":"none"}),None) }, None=>bail!("NO_SELF_ACTION") };
    if a["type"]=="kakan" { a["consumed"]=json!(engine.kakan_consumed_mjai(a["pai"].as_str().unwrap_or(""))
        .ok_or_else(||anyhow::anyhow!("MISSING_PON"))?); }
    ensure!(a["type"]!="none" || response, "INVALID_PASS");
    if let Some(f)=follow.as_mut() { f["tsumogiri"]=json!(engine.drawn_tile_mjai().map_or(false,|p|f["pai"]==p)); }
    let mut result=json!({"protocol":PROTOCOL,"type":"result","requestId":id,"action":a});
    if let Some(f)=follow {result["followUp"]=f;}
    if audit {let (obs,mask,logits)=engine.snapshot()?;result["audit"]=json!({"observation":obs,"mask":mask,"logits":logits});}
    Ok(result)
}
fn run() -> Result<()> {
    let args:Vec<String>=std::env::args().collect();
    let weights=args.windows(2).find(|w|w[0]=="--weights").map(|w|&w[1]).ok_or_else(||anyhow::anyhow!("WEIGHTS_REQUIRED"))?;
    let bytes=fs::read(weights)?;ensure!(bytes.len()==2641816 && hash(&bytes)==WEIGHT_SHA,"WEIGHT_HASH_MISMATCH");
    let mut engine=Engine::new(bytes,4,0)?;
    engine.snapshot()?; // Real forward before ready.
    let binary=hash(&fs::read(std::env::current_exe()?)?);
    let identity=json!({"model":"akagi-v3-native","runtime":format!("akagi-native-win64-cpu-jsonl-v1-p1-{}",&binary[..16]),"checkpoint":WEIGHT_SHA,"sourceCommit":COMMIT});
    emit(json!({"protocol":PROTOCOL,"type":"ready","identity":identity}))?;
    let audit=args.iter().any(|s|s=="--audit");
    let mut input=io::stdin().lock();
    loop { let mut bytes=Vec::new(); let count=Read::take(input.by_ref(),2*1024*1024+1).read_until(b'\n',&mut bytes)?;
        if count==0 {break;} ensure!(count<=2*1024*1024 && bytes.last()==Some(&b'\n'),"INPUT_LIMIT");
        let raw:Value=serde_json::from_slice(&bytes).map_err(|_|anyhow::anyhow!("INVALID_JSON"))?;
        match replay(&mut engine,&raw,audit) {Ok(v)=>emit(v)?,Err(e)=>{let code=e.to_string();
            let code=if code.chars().all(|c|c.is_ascii_uppercase()||c=='_'){code}else{"INFERENCE_FAILED".into()};
            emit(json!({"protocol":PROTOCOL,"type":"error","requestId":raw["requestId"],"code":code}))?;
        }}
    } Ok(())
}
fn main(){if run().is_err(){eprintln!("AKAGI_NATIVE_FAILED");std::process::exit(1);}}
#[cfg(test)]
#[path = "stage0_tests.rs"]
mod stage0_tests;
