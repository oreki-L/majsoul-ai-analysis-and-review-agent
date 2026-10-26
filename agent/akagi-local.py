#!/usr/bin/env python3
"""Offline, pinned Akagi v2 weak-example model profile (Windows x64 / CPython 3.11).

Third-party code/weights stay in the user's download directory. Only the reviewed
neural-network class definitions are loaded; upstream imports, settings loaders,
Bot wrapper and HTTP inference implementation are never executed.
"""
import argparse
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location("mjai_wrapper", Path(__file__).with_name("mjai-python-wrapper.py"))
wrapper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wrapper)


def load_bot(directory, seat):
    import functools
    import typing
    import numpy as np
    import torch
    from torch import nn, Tensor
    from torch.nn import functional as F
    from torch.distributions import Normal, Categorical

    manifest = json.loads(Path(__file__).with_name("akagi-source.json").read_text("utf-8"))
    root = Path(directory).resolve()
    for item in manifest["files"]:
        if hashlib.sha256((root / item["name"]).read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError("SOURCE_HASH_MISMATCH")
    libspec = importlib.util.spec_from_file_location("libriichi", root / "libriichi.pyd")
    libriichi = importlib.util.module_from_spec(libspec)
    libspec.loader.exec_module(libriichi)
    classes = {"ChannelAttention", "ResBlock", "ResNet", "Brain", "DQN", "MortalEngine"}
    tree = ast.parse((root / "model.py").read_text("utf-8"))
    nodes = []
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name in classes:
            if node.name == "MortalEngine":
                node.body = [method for method in node.body if not isinstance(method, ast.FunctionDef) or method.name != "react_batch"]
            nodes.append(node)
        elif isinstance(node, ast.FunctionDef) and node.name == "sample_top_p":
            nodes.append(node)
    namespace = dict(vars(typing), torch=torch, np=np, nn=nn, Tensor=Tensor, F=F,
                     Normal=Normal, Categorical=Categorical, partial=functools.partial,
                     obs_shape=libriichi.consts.obs_shape,
                     oracle_obs_shape=libriichi.consts.oracle_obs_shape,
                     ACTION_SPACE=libriichi.consts.ACTION_SPACE)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(root / "model.py"), "exec"), namespace)

    def offline_react_batch(self, obs, masks, invisible_obs):
        with torch.inference_mode():
            return self._react_batch(obs, masks, invisible_obs)

    namespace["MortalEngine"].react_batch = offline_react_batch
    torch.set_num_threads(1)
    state = torch.load(root / "mortal.pth", map_location="cpu", weights_only=True)
    version = state["config"]["control"]["version"]
    brain = namespace["Brain"](version=version, **{key: state["config"]["resnet"][key] for key in ("conv_channels", "num_blocks")})
    dqn = namespace["DQN"](version=version)
    brain.load_state_dict(state["mortal"])
    dqn.load_state_dict(state["current_dqn"])
    engine = namespace["MortalEngine"](brain, dqn, False, version, enable_quick_eval=False,
                                        enable_rule_based_agari_guard=True, name="Akagi v2 weak example")
    return libriichi.mjai.Bot(engine, seat)


def finish_decision(bot, raw):
    """libriichi selects the declaration discard after receiving its own reach."""
    action = wrapper.clean_action(raw)
    if action["type"] != "reach":
        return action
    follow_up = wrapper.clean_action(bot.react(json.dumps(action, separators=(",", ":"))))
    if follow_up["type"] != "dahai" or follow_up["actor"] != action["actor"]:
        raise ValueError("Missing declaration discard")
    return {"action": action, "followUp": follow_up}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", required=True)
    args = parser.parse_args()
    stage = "INVALID_INPUT"
    try:
        events, seat = wrapper.read_events()
        stage = "MODEL_LOAD_FAILED"
        with wrapper.debug_to_stderr():
            bot = load_bot(args.dir, seat)
            stage = "INFERENCE_FAILED"
            action = None
            for event in events:
                action = bot.react(json.dumps(event, separators=(",", ":")))
            action = finish_decision(bot, action)
        stage = "INVALID_ACTION"
        sys.stdout.write(json.dumps(wrapper.clean_result(action), separators=(",", ":")) + "\n")
        sys.stdout.flush()
        return 0
    except Exception:
        sys.stderr.write("Akagi local profile failed: " + stage + "\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
