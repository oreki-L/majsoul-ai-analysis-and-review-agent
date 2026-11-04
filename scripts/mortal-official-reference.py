"""Independent official model/engine/Bot reference; never imports mortal-worker."""
import argparse
import hashlib
import json
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", required=True)
    parser.add_argument("--checkpoint", default="mortal_298k.pth")
    args = parser.parse_args()
    root = Path(args.dir).resolve()
    sys.path.insert(0, str(root))
    import torch
    import libriichi
    from model import Brain, DQN
    from engine import MortalEngine
    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    state = torch.load(root / args.checkpoint, weights_only=True, map_location="cpu")
    cfg = state["config"]
    brain = Brain(version=cfg["control"]["version"], **{k: cfg["resnet"][k] for k in ("conv_channels", "num_blocks")}).eval()
    dqn = DQN(version=4).eval()
    brain.load_state_dict(state["mortal"], strict=True)
    dqn.load_state_dict(state["current_dqn"], strict=True)

    class ReferenceEngine(MortalEngine):
        def react_batch(self, obs, masks, invisible_obs):
            result = super().react_batch(obs, masks, invisible_obs)
            finite = [[q for q, allowed in zip(row, mask) if allowed] for row, mask in zip(result[1], result[2])]
            self.numerics.append({"actions": result[0], "masks": result[2], "legalQ": finite})
            return result

    for line in sys.stdin:
        request = json.loads(line)
        engine = ReferenceEngine(brain, dqn, is_oracle=False, version=4, enable_amp=False,
                                 enable_quick_eval=True, enable_rule_based_agari_guard=True)
        engine.numerics = []
        bot = libriichi.mjai.Bot(engine, request["seat"])
        raw = None
        for event in request["events"]:
            raw = bot.react(json.dumps(event))
        action = json.loads(raw) if raw is not None else None
        if action is None and request["events"][-1]["type"] in ("dahai", "ankan", "kakan") and request["events"][-1].get("actor") != request["seat"]:
            action = {"type": "none"}
        follow = None
        if action and action["type"] == "reach":
            follow = json.loads(bot.react(json.dumps({"type": "reach", "actor": request["seat"]})))
        # This cleaner is deliberately independent from the product wrapper.
        def clean(value):
            return {k: v for k, v in value.items() if k != "meta"} if value else None
        print(json.dumps({"action": clean(action), "followUp": clean(follow),
                          "numericsSha256": hashlib.sha256(json.dumps(engine.numerics, sort_keys=True, allow_nan=False).encode()).hexdigest(),
                          "lastNumerics": engine.numerics[-1] if engine.numerics else None}, allow_nan=False), flush=True)


if __name__ == "__main__":
    main()
