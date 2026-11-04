use anyhow::{Result,ensure,bail};
use serde_json::{Value,json};
use std::{fs,io::{self,BufRead}};
use native_bot::{engine::{Engine,BotAction},model::Model,adapt::obs_and_legal_4p,action_codec::legal_mask};
use riichienv_core::{state::GameState,rule::GameRule,replay::MjaiEvent,parser::tid_to_mjai};
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
fn main()->Result<()> {
 let args:Vec<String>=std::env::args().collect();let bytes=fs::read(&args[1])?;
 let model=Model::from_safetensors(bytes.clone(),4)?;let mut engine=Engine::new(bytes,4,0)?;
 for line in io::stdin().lock().lines() {let raw:Value=serde_json::from_str(&line?)?;let seat=raw["seat"].as_u64().unwrap() as u8;
  engine.reset();engine.set_seat(seat);let mut state=GameState::new(0,true,None,0,GameRule::default_tenhou());
  for v in raw["events"].as_array().unwrap(){let mut v=v.clone();if v["type"]=="start_game"{v["id"]=json!(seat.to_string());}let event:MjaiEvent=serde_json::from_value(v)?;
   engine.feed(event.clone());let kakan=match &event {MjaiEvent::Kakan{actor,pai} if *actor!=seat as usize=>Some((*actor as u8,pai.clone())),_=>None};state.apply_mjai_event(event);if let Some((actor,pai))=kakan{native_bot::chankan::open_on_kakan(&mut state,actor,&pai,seat);}
  }
  let (obs,legal)=obs_and_legal_4p(&mut state,seat);let logits=model.forward_logits(&obs)?;let mask=legal_mask(&legal,4);
  let (a,mut f)=match engine.decide()?{Some(d)=>action(d.action,seat)?,None=>(json!({"type":"none"}),None)};
  if let Some(f)=f.as_mut(){f["tsumogiri"]=json!(state.drawn_tile.map(tid_to_mjai).map_or(false,|p|f["pai"]==p));}
  println!("{}",json!({"requestId":raw["requestId"],"action":a,"followUp":f,"audit":{"observation":obs,"mask":mask,"logits":logits}}));
 }Ok(())}
