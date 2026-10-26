#!/usr/bin/env python3
"""JSONL adapter for a user-provided synchronous Bot.react implementation."""
import argparse
import contextlib
import importlib
import inspect
import json
import os
import re
import sys


def reject_constant(_value):
    raise ValueError("Non-finite JSON number")


def loads(value):
    return json.loads(value, parse_constant=reject_constant)


@contextlib.contextmanager
def debug_to_stderr():
    """Keep Python and native-library debug prints out of the JSONL channel."""
    sys.stdout.flush()
    saved = os.dup(1)
    try:
        os.dup2(2, 1)
        with contextlib.redirect_stdout(sys.stderr):
            yield
    finally:
        sys.stderr.flush()
        os.dup2(saved, 1)
        os.close(saved)


def clean_action(value):
    if isinstance(value, str):
        value = loads(value)
    if not isinstance(value, dict) or not isinstance(value.get("type"), str):
        raise ValueError("Invalid action")
    # Reject non-JSON/non-finite values even inside metadata that will be removed.
    json.dumps(value, allow_nan=False)
    schemas = {
        "none": (), "dahai": ("actor", "pai", "tsumogiri"),
        "reach": ("actor",), "chi": ("actor", "target", "pai", "consumed"),
        "pon": ("actor", "target", "pai", "consumed"),
        "daiminkan": ("actor", "target", "pai", "consumed"),
        "ankan": ("actor", "consumed"), "kakan": ("actor", "pai", "consumed"),
        "hora": ("actor", "target", "pai"), "ryukyoku": ("actor",),
    }
    kind = value["type"]
    if kind not in schemas:
        raise ValueError("Unsupported action")
    action = {"type": kind}
    for key in schemas[kind]:
        field = value[key]
        if key in ("actor", "target"):
            if type(field) is not int or not 0 <= field <= 3:
                raise ValueError("Invalid seat")
        elif key == "tsumogiri":
            if type(field) is not bool:
                raise ValueError("Invalid discard")
        elif key == "pai":
            check_tile(field)
        elif key == "consumed":
            count = 4 if kind == "ankan" else 3 if kind in ("daiminkan", "kakan") else 2
            if not isinstance(field, list) or len(field) != count:
                raise ValueError("Invalid consumed tiles")
            for tile in field:
                check_tile(tile)
        action[key] = field
    return action


def check_tile(tile):
    if not isinstance(tile, str) or not re.fullmatch(r"(?:[1-9][mps]|5[mps]r|[ESWNPFC])", tile):
        raise ValueError("Invalid tile")


class SignatureUnavailable(ValueError):
    pass


def check_arguments(target, arguments, strict):
    try:
        signature = inspect.signature(target)
    except (TypeError, ValueError):
        # Native/PyO3 callables may work without publishing a Python signature.
        # Only the optional inspection command requires inspectability.
        if strict:
            raise SignatureUnavailable() from None
        return
    # A published signature with a definite mismatch must still fail.
    signature.bind(*arguments)


def check_interface(bot_class, constructor, strict=False):
    if not inspect.isclass(bot_class):
        raise ValueError("Expected class")
    check_arguments(bot_class, [0] if constructor == "seat" else [], strict)
    react = getattr(bot_class, "react")
    if not callable(react) or inspect.iscoroutinefunction(react) or inspect.isasyncgenfunction(react) or inspect.isgeneratorfunction(react):
        raise ValueError("Expected synchronous react")
    descriptor = inspect.getattr_static(bot_class, "react")
    arguments = ("[]",) if isinstance(descriptor, (staticmethod, classmethod)) else (object(), "[]")
    check_arguments(react, arguments, strict)


def read_events():
    line = sys.stdin.buffer.readline(2 * 1024 * 1024 + 1)
    if len(line) > 2 * 1024 * 1024 or not line.endswith(b"\n"):
        raise ValueError("Invalid input size")
    events = loads(line.decode("utf-8"))
    if not isinstance(events, list) or not events or any(not isinstance(event, dict) for event in events):
        raise ValueError("Expected event array")
    starts = [event for event in events if event.get("type") == "start_game"]
    if len(starts) != 1 or events[0] is not starts[0]:
        raise ValueError("Expected unique initial start_game")
    seat = starts[0].get("id")
    if type(seat) is not int or not 0 <= seat <= 3:
        raise ValueError("Invalid player id")
    return events, seat


def main():
    parser = argparse.ArgumentParser(description="Adapt a user-provided synchronous Bot.react(events_json) to mjai JSONL. Supply your own Python module and model weights; no model or third-party library is bundled or downloaded.")
    parser.add_argument("--module", required=True, help="Importable user module; its class configures weights itself")
    parser.add_argument("--class", dest="class_name", default="Bot", help="Bot class (default: Bot)")
    parser.add_argument("--module-dir", help="Directory to add to Python's module search path")
    parser.add_argument("--constructor", choices=("zero", "seat"), default="zero", help="Construct Bot() (default) or Bot(start_game.id); no automatic fallback")
    parser.add_argument("--check", action="store_true", help="Import module and inspect signatures only; does not construct Bot or call react. Import side effects still apply; this does not validate model availability.")
    args = parser.parse_args()
    stage = "IMPORT_FAILED"
    try:
        if args.module_dir:
            sys.path.insert(0, os.path.abspath(args.module_dir))
        with debug_to_stderr():
            module = importlib.import_module(args.module)
            stage = "INTERFACE_INCOMPATIBLE"
            bot_class = getattr(module, args.class_name)
            check_interface(bot_class, args.constructor, strict=args.check)
        if args.check:
            sys.stdout.write(json.dumps({"format": "mjai-python-interface-v1", "constructor": args.constructor,
                                         "react": "events-json", "signatureCompatible": True,
                                         "inferenceVerified": False}, separators=(",", ":")) + "\n")
            return 0
        # A fresh process handles one inference; never print observations back out.
        stage = "INVALID_INPUT"
        events, seat = read_events()
        with debug_to_stderr():
            stage = "CONSTRUCTOR_FAILED"
            bot = bot_class(*([seat] if args.constructor == "seat" else []))
            stage = "REACT_FAILED"
            raw = bot.react(json.dumps(events, ensure_ascii=True, allow_nan=False))
        stage = "INVALID_ACTION"
        result = json.dumps(clean_action(raw), ensure_ascii=True, allow_nan=False, separators=(",", ":"))
        sys.stdout.write(result + "\n")
        sys.stdout.flush()
        return 0
    except SignatureUnavailable:
        sys.stderr.write("mjai wrapper failed: SIGNATURE_UNAVAILABLE\n")
        return 1
    except BaseException:
        sys.stderr.write("mjai wrapper failed: " + stage + "\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
