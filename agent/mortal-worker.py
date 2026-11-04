#!/usr/bin/env python3
"""Explicitly launched offline CPU worker. No downloads, settings or training imports."""
import argparse
import contextlib
import hashlib
import importlib.util
import json
import platform
import os
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("mjai_wrapper", BASE / "mjai-python-wrapper.py")
wrapper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wrapper)
MANIFEST = json.loads((BASE / "mortal-source.json").read_text("utf-8"))


@contextlib.contextmanager
def quiet_native():
    """Discard upstream/native diagnostics; they may contain observations."""
    sys.stdout.flush()
    sys.stderr.flush()
    saved = [os.dup(1), os.dup(2)]
    try:
        with open(os.devnull, "w") as sink:
            os.dup2(sink.fileno(), 1)
            os.dup2(sink.fileno(), 2)
            with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
                yield
    finally:
        for fd, original in zip((1, 2), saved):
            os.dup2(original, fd)
            os.close(original)


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


class Runtime:
    def __init__(self, directory, profile="voidshine-298k"):
        global MANIFEST
        base = json.loads((BASE / "mortal-source.json").read_text("utf-8"))
        if profile != base["profile"] and profile not in base["profiles"]:
            raise ValueError("UNKNOWN_PROFILE")
        MANIFEST = {**base, **base.get("profiles", {}).get(profile, {})}
        root = Path(directory).resolve()
        for item in MANIFEST["files"]:
            if digest(root / item["name"]) != item["sha256"]:
                raise ValueError("SOURCE_HASH_MISMATCH")
        build = json.loads((root / "libriichi-build.json").read_text("utf-8"))
        if build["sourceCommit"] != MANIFEST["sourceCommit"] or build["features"] != ["pymod"] or build["abi"] != MANIFEST["native"]["abi"] or build["sha256"] != MANIFEST["native"]["sha256"]:
            raise ValueError("NATIVE_SOURCE_MISMATCH")
        if digest(root / "libriichi.pyd") != build["sha256"]:
            raise ValueError("NATIVE_HASH_MISMATCH")
        if platform.system() != "Windows" or platform.machine().lower() not in ("amd64", "x86_64"):
            raise ValueError("PLATFORM_UNSUPPORTED")
        import torch
        import numpy
        expected = MANIFEST["runtime"]
        if platform.python_version() != expected["python"] or torch.__version__ != expected["torch"] or numpy.__version__ != expected["numpy"]:
            raise ValueError("RUNTIME_VERSION_MISMATCH")
        torch.set_num_threads(expected["threads"])
        torch.set_num_interop_threads(1)
        torch.use_deterministic_algorithms(True)
        sys.path.insert(0, str(root))
        import libriichi
        from model import Brain, DQN
        from engine import MortalEngine
        state = torch.load(root / MANIFEST["files"][0]["name"], weights_only=True, map_location="cpu")
        cfg = state["config"]
        if cfg["control"]["version"] != 4 or any(cfg["resnet"][k] != v for k, v in MANIFEST["architecture"].items() if k != "version"):
            raise ValueError("ARCHITECTURE_MISMATCH")
        self.brain = Brain(version=4, conv_channels=192, num_blocks=40).eval()
        self.dqn = DQN(version=4).eval()
        self.brain.load_state_dict(state["mortal"], strict=True)
        self.dqn.load_state_dict(state["current_dqn"], strict=True)
        self.Bot, self.Engine = libriichi.mjai.Bot, MortalEngine
        self.identity = {"model": MANIFEST["model"], "modelRevision": MANIFEST["modelRevision"],
                         "checkpoint": MANIFEST["files"][0]["sha256"], "sourceCommit": MANIFEST["sourceCommit"],
                         "runtime": "win64-py3119-torch270cpu-np1262-" + build["sha256"][:16]}

    def infer(self, seat, events):
        # New lightweight engine AND Bot per request; only eval networks are shared.
        engine = self.Engine(self.brain, self.dqn, False, 4, enable_quick_eval=True,
                             enable_rule_based_agari_guard=True, enable_amp=False,
                             stochastic_latent=False, name=MANIFEST["model"])
        bot = self.Bot(engine, seat)
        raw = None
        for event in events:
            raw = bot.react(json.dumps(event, separators=(",", ":")))
        if raw is None and events[-1].get("type") in ("dahai", "ankan", "kakan") and events[-1].get("actor") != seat:
            # Official quick-eval emits no reply when there is no response choice.
            action = {"type": "none"}
        else:
            action = wrapper.clean_action(raw)
        result = {"action": action}
        if action["type"] == "reach":
            follow = wrapper.clean_action(bot.react(json.dumps(action, separators=(",", ":"))))
            if follow["type"] != "dahai" or follow["actor"] != seat:
                raise ValueError("DECLARATION_DISCARD_MISSING")
            result["followUp"] = follow
        return result

    def warmup(self):
        # Artificial public fixture only. Every new process runs a real forward
        # pass before ready, including recovery after cancellation or a crash.
        hand = ["E", "6p", "9m", "8m", "C", "2s", "7m", "S", "6m", "1m", "S", "3s", "8m"]
        events = [
            {"type": "start_game", "id": 0, "names": ["Player 0", "Player 1", "Player 2", "Player 3"]},
            {"type": "start_kyoku", "bakaze": "E", "dora_marker": "2s", "kyoku": 1,
             "honba": 0, "kyotaku": 0, "oya": 0, "scores": [25000] * 4,
             "tehais": [hand, *[["?"] * 13 for _ in range(3)]]},
            {"type": "tsumo", "actor": 0, "pai": "1m"},
        ]
        action = self.infer(0, events)["action"]
        if (action.get("type") != "dahai" or action.get("actor") != 0
                or action.get("pai") not in hand + ["1m"]
                or type(action.get("tsumogiri")) is not bool
                or (action["tsumogiri"] and action["pai"] != "1m")):
            raise ValueError("WARMUP_ACTION_INVALID")


def emit(value):
    print(json.dumps(value, separators=(",", ":"), allow_nan=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", required=True)
    parser.add_argument("--profile", default="voidshine-298k")
    args = parser.parse_args()
    with quiet_native():
        runtime = Runtime(args.dir, args.profile)
        runtime.warmup()
    emit({"protocol": MANIFEST["protocol"], "type": "ready", "identity": runtime.identity})
    while True:
        line = sys.stdin.buffer.readline(2 * 1024 * 1024 + 1)
        if not line:
            return
        if len(line) > 2 * 1024 * 1024 or not line.endswith(b"\n"):
            raise ValueError("INPUT_LIMIT")
        request = wrapper.loads(line.decode("utf-8"))
        if request.get("protocol") != MANIFEST["protocol"] or not isinstance(request.get("requestId"), str):
            raise ValueError("PROTOCOL_MISMATCH")
        events, seat = request["events"], request["seat"]
        if type(seat) is not int or seat not in range(4) or not isinstance(events, list) or not events or events[0] != {**events[0], "type": "start_game", "id": seat}:
            raise ValueError("INVALID_INPUT")
        with quiet_native():
            if events[-1].get("type") in ("reach_accepted", "dora"):
                result = None
            else:
                result = runtime.infer(seat, events)
        if result is None:
            emit({"protocol": MANIFEST["protocol"], "type": "error", "requestId": request["requestId"], "code": "UNSUPPORTED_TRAILING_ANNOUNCEMENT"})
            continue
        emit({"protocol": MANIFEST["protocol"], "type": "result", "requestId": request["requestId"], **result})


if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        # Never expose event/hand data or exception messages from upstream.
        sys.stderr.write("MORTAL_WORKER_FAILED: " + type(error).__name__ + "\n")
        sys.exit(1)
