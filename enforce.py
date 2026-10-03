"""Ask-mode enforcement — the note asks the model; this makes it true.

Ask mode is documented as read-only. A prompt alone is a request, not a
guarantee, so the agent half also vetoes the tool calls that would change
something while a session is in ask mode.

Policy (fail-closed, never fail-silent):

* **Tools** — a fixed deny-list of state-changing tools, plus anything whose
  name matches a mutation verb (write/edit/save/delete/move/install/…).
* **``terminal``** — every command segment must match a read-only allow-list
  and the whole command must be free of redirection and mutating tokens. When
  in doubt the command is blocked: ask mode is read-only by contract, and the
  note tells the model to answer and close with the mandated sentence.

Nothing here is a sandbox: it is a policy gate for a mode the user chose. Set
``HERMES_COMPOSER_MODES_ASK_ENFORCE=0`` to turn ask enforcement off.

Plan mode is read-only too — with one exception: the plan markdown file and
the optional questions JSON, both under ``.hermes/plans/``. Everything else
is judged exactly like ask mode. Set
``HERMES_COMPOSER_MODES_PLAN_ENFORCE=0`` to turn it off.
"""

from __future__ import annotations

import os
import re
from pathlib import PurePosixPath

try:  # package context (real plugin load)
    from .modes import role_from_goal
except ImportError:  # top-level context (tests import enforce directly)
    from modes import role_from_goal

__all__ = [
    "ask_enforcement_enabled",
    "ask_block_message",
    "plan_enforcement_enabled",
    "plan_block_message",
    "orchestrator_enforcement_enabled",
    "orchestrator_block_message",
]

#: Tools that always change state, whatever their arguments look like.
DENY_TOOLS = frozenset(
    {
        "write_file",
        "patch",
        "browser_exec",
        "computer_use",
        "cronjob_manage",
        "process_manage",
        "delegate_task",
        "skill_manage",
        "memory",
        "todo_list",
    }
)

#: Name shapes that mean "this tool mutates something".
_MUTATING_NAME_RE = re.compile(
    r"(?:^|_)(write|edit|save|append|delete|remove|move|copy|create|rename|mkdir|rmdir|"
    r"install|uninstall|upload|publish|deploy|apply_patch|commit|push|format|kill|start|stop|restart|send|post)(?:_|$)",
    re.IGNORECASE,
)

#: Command prefixes that are read-only on their own.
_READ_ONLY_COMMAND_RE = re.compile(
    r"^\s*(?:"
    r"cat|bat|head|tail|less|more|wc|ls|dir|tree|stat|file|du|df|md5sum|sha1sum|sha256sum|"
    r"cksum|pwd|date|whoami|hostname|uname|id|echo|printf|which|type|command -v|"
    r"find|fd|grep|rg|ag|ack|sed\s+-n|awk|sort|uniq|cut|tr|join|paste|nl|column|jq|yq|xmllint|"
    r"diff|cmp|comm|basename|dirname|realpath|readlink|seq|expr|bc|test|\[|true|false|"
    r"git\s+(?:status|log|show|diff|branch|remote|rev-parse|describe|blame|ls-files|ls-tree|"
    r"cat-file|shortlog|tag|stash\s+list|config\s+--get|config\s+--list|name-rev|for-each-ref|"
    r"worktree\s+list|submodule\s+status|fsck|reflog|whatchanged|grep|count-objects)|"
    r"hg\s+(?:status|log|diff|summary)|svn\s+(?:status|info|log|diff)|"
    r"(?:python|python3|node|npm|pnpm|yarn|bun|pip|pip3|uv|cargo|go|dotnet|java|deno|rustc|"
    r"tsc|npx|git|gh|docker|kubectl|hermes)\s+(?:--version|-V|-h|--help)\b|"
    r"npm\s+(?:ls|list|view|info|outdated|why|config\s+get)|"
    r"pnpm\s+(?:ls|list|why|outdated)|"
    r"pip\s+(?:list|show|freeze|check)|"
    r"gh\s+(?:pr\s+(?:view|list|diff|checks)|issue\s+(?:view|list)|repo\s+view|run\s+(?:view|list)|api|auth\s+status)|"
    r"docker\s+(?:ps|images|inspect|logs|version|info)|"
    r"kubectl\s+(?:get|describe|logs|version|config\s+view)|"
    r"systemctl\s+(?:status|list-units|is-active)|"
    r"open|code|explorer|start\s+\"\"|env"
    r")\b"
)

#: Tokens that write, wherever they appear in the command line.
_MUTATING_TOKEN_RE = re.compile(
    r"(?:>>?|\|\s*tee\b|\btee\b|\bdd\b|\btruncate\b|\bshred\b|\bchmod\b|\bchown\b|\bchgrp\b|"
    r"\bumask\b|\bln\b|\bmv\b|\bcp\b|\brm\b|\brmdir\b|\bmkdir\b|\btouch\b|\binstall\b|\brsync\b|"
    r"\bscp\b|\bsed\s+-i|\bperl\s+-i|\bpython\s+-c|\bpython3\s+-c|\bnode\s+-e|\bsudo\b|\bsu\b|"
    r"-delete\b|-exec\b|-execdir\b|-ok\b|-fprint|\btruncate\b|"
    r"\bsystemctl\s+(?:start|stop|restart|enable|disable)\b|\bservice\b|\bgit\s+(?:add|commit|"
    r"push|pull|fetch|merge|rebase|checkout|switch|restore|reset|clean|apply|am|cherry-pick|"
    r"stash(?!\s+list)|tag\s+-|remote\s+(?:add|remove|set-url)|init|clone|config\s+(?!--get|--list))|"
    r"\bnpm\s+(?:i|install|ci|run|test|start|audit\s+fix|publish|link|uninstall)\b|"
    r"\bpnpm\s+(?:i|install|add|remove|run|test|publish)\b|\byarn\s+(?:add|install|run)\b|"
    r"\bpip3?\s+(?:install|uninstall|download)\b|\buv\s+(?:pip|sync|add|remove)\b|"
    r"\bcargo\s+(?:install|build|run|test|add|remove|publish)\b|\bgo\s+(?:build|run|install|test|mod)\b|"
    r"\bdocker\s+(?:run|build|exec|rm|stop|start|compose\s+(?:up|down|build|run))\b|"
    r"\bkubectl\s+(?:apply|delete|create|edit|exec|patch|scale|rollout)\b|"
    r"\bgh\s+(?:pr\s+(?:create|merge|close|comment|edit|checkout)|issue\s+(?:create|close|comment|edit)|"
    r"release\s+create|repo\s+(?:create|delete|clone|fork)|workflow\s+run)\b|"
    r"\bhermes\s+(?:plugins\s+(?:install|remove|enable|disable|update)|cron|config\s+set|update)\b|"
    r"\bdel\b|\berase\b|\brd\s+/|\bren\b|\bmove\b|\bcopy\b|\btype\s+>\b)"
)

#: Shell separators — each segment of a chained command is judged on its own.
_SEGMENT_SPLIT_RE = re.compile(r"(?:&&|\|\||;|\||\n)")


def ask_enforcement_enabled() -> bool:
    """Ask-mode enforcement is on unless explicitly switched off."""
    return str(os.environ.get("HERMES_COMPOSER_MODES_ASK_ENFORCE", "1")).strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def _terminal_is_read_only(command: str) -> bool:
    if not command.strip():
        return False
    if _MUTATING_TOKEN_RE.search(command):
        return False
    for segment in _SEGMENT_SPLIT_RE.split(command):
        if not segment.strip():
            continue
        if not _READ_ONLY_COMMAND_RE.match(segment):
            return False
    return True


def ask_block_message(tool_name: str, args: object) -> str | None:
    """The block message for a tool call that ask mode must refuse, or ``None``."""
    if not ask_enforcement_enabled():
        return None
    if not tool_name:
        return None
    name = str(tool_name)
    if name == "terminal":
        command = ""
        if isinstance(args, dict):
            command = str(args.get("command") or "")
        if _terminal_is_read_only(command):
            return None
        return (
            f"[composer-modes] Ask mode is read-only: the terminal command was blocked because "
            f"it is not a read-only inspection. Do the read-only part of the request with the "
            f"tools that are allowed, answer what you can, and end your reply with the mandated "
            f"Ask closing sentence so the user can re-ask in Agent mode."
        )
    if name in DENY_TOOLS or _MUTATING_NAME_RE.search(name):
        return (
            f"[composer-modes] Ask mode is read-only: the tool '{name}' can change state, so the "
            f"call was blocked before it ran. Nothing was written. Answer with the allowed "
            f"read-only work and end your reply with the mandated Ask closing sentence so the "
            f"user can re-ask in Agent mode."
        )
    return None


# ── Plan mode ────────────────────────────────────────────────────────────────
# Read-only, except writing the plan markdown and the optional questions JSON
# under .hermes/plans/. Everything else is judged exactly like ask mode.

#: Where plan mode may write, relative to the workspace root.
PLAN_DIR = ".hermes/plans"

#: The one terminal command plan mode may run that is not read-only: creating
#: the plans directory.
_PLAN_MKDIR_RE = re.compile(r"^\s*mkdir\s+(?:-p\s+)?\"?\.hermes/plans\"?\s*$")

#: File-writing tools that plan mode may use for the plan files.
_PLAN_FILE_TOOLS = frozenset({"write_file", "patch"})


def plan_enforcement_enabled() -> bool:
    """Plan-mode enforcement is on unless explicitly switched off."""
    return str(os.environ.get("HERMES_COMPOSER_MODES_PLAN_ENFORCE", "1")).strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def _plan_path_allowed(path: object) -> bool:
    """True when *path* resolves to inside ``.hermes/plans/``."""
    if not isinstance(path, str) or not path.strip():
        return False
    p = path.strip()
    if p.startswith(("/", "~")):
        # Absolute / home paths can never be the workspace-relative plan file.
        return False
    # Resolve .. segments (no filesystem access) and require the plans prefix.
    parts = PurePosixPath(p).parts
    resolved: list[str] = []
    for part in parts:
        if part in ("", "."):
            continue
        if part == "..":
            if not resolved:
                return False  # escaped above the workspace root
            resolved.pop()
        else:
            resolved.append(part)
    return len(resolved) > 2 and resolved[0] == ".hermes" and resolved[1] == "plans"


def plan_block_message(tool_name: str, args: object) -> str | None:
    """The block message for a tool call plan mode must refuse, or ``None``."""
    if not plan_enforcement_enabled():
        return None
    if not tool_name:
        return None
    name = str(tool_name)
    door_out = (
        " If the request needs anything else, answer what you can with the allowed work and tell "
        "the user to re-ask in Agent mode."
    )
    if name in _PLAN_FILE_TOOLS:
        path = args.get("path") if isinstance(args, dict) else None
        if _plan_path_allowed(path):
            return None
        return (
            f"[composer-modes] Plan mode is read-only except the plan files: '{name}' was blocked "
            f"because its target is not inside {PLAN_DIR}/. You may only write the plan markdown "
            f"and the questions JSON under {PLAN_DIR}/ (e.g. {PLAN_DIR}/2026-01-01_120000-<slug>.md)."
            + door_out
        )
    if name == "terminal":
        command = ""
        if isinstance(args, dict):
            command = str(args.get("command") or "")
        if command.strip() and _PLAN_MKDIR_RE.match(command):
            return None
        if _terminal_is_read_only(command):
            return None
        return (
            f"[composer-modes] Plan mode is read-only: the terminal command was blocked because "
            f"it is not a read-only inspection (and not `mkdir -p .hermes/plans`). Inspect with "
            f"read-only commands; only the plan markdown and questions JSON under {PLAN_DIR}/ may "
            f"be written." + door_out
        )
    if name in DENY_TOOLS or _MUTATING_NAME_RE.search(name):
        return (
            f"[composer-modes] Plan mode is read-only except the plan files: the tool '{name}' can "
            f"change state, so the call was blocked before it ran. Nothing was written. Only the "
            f"plan markdown and questions JSON under {PLAN_DIR}/ may be written." + door_out
        )
    return None


# ── Orchestrator mode ────────────────────────────────────────────────────────
# The orchestrator coordinates subagents. It MAY delegate (delegate_task), run
# code/tests/builds (terminal) to verify, and inspect (read-only). It must NOT
# author: no file writes/deletes/moves, no package installs, no git mutations,
# no service control, no privilege escalation.

#: The one state-changing tool orchestrator mode may call.
_ORCH_DELEGATE_TOOL = "delegate_task"

#: Hard mutations orchestrator mode must never run. This is the mutating-token
#: list MINUS the execution subcommands (npm test / npm run / python -c /
#: node -e / cargo test / go test / ...) so the orchestrator can still run the
#: code and tests it is verifying.
_ORCH_HARD_MUTATING_RE = re.compile(
    r"(?:>>?|\|\s*tee\b|\btee\b|\bdd\b|\btruncate\b|\bshred\b|\bchmod\b|\bchown\b|\bchgrp\b|"
    r"\bumask\b|\bln\b|\bmv\b|\bcp\b|\brm\b|\brmdir\b|\bmkdir\b|\btouch\b|\binstall\b|\brsync\b|"
    r"\bscp\b|\bsed\s+-i|\bperl\s+-i|"
    r"-delete\b|-exec\b|-execdir\b|-ok\b|-fprint|"
    r"\bsystemctl\s+(?:start|stop|restart|enable|disable)\b|\bservice\b|"
    r"\bgit\s+(?:add|commit|push|pull|fetch|merge|rebase|checkout|switch|restore|reset|clean|apply|am|cherry-pick|"
    r"stash(?!\s+list)|tag\s+-|remote\s+(?:add|remove|set-url)|init|clone|config\s+(?!--get|--list))|"
    r"\bnpm\s+(?:i|install|ci)\b|"
    r"\bpnpm\s+(?:i|install|add|remove)\b|\byarn\s+(?:add|install)\b|"
    r"\bpip3?\s+(?:install|uninstall|download)\b|\buv\s+(?:pip|sync|add|remove)\b|"
    r"\bcargo\s+(?:install|add|remove)\b|\bgo\s+(?:install|mod)\b|"
    r"\bdocker\s+(?:run|build|exec|rm|stop|start|compose\s+(?:up|down|build|run))\b|"
    r"\bkubectl\s+(?:apply|delete|create|edit|exec|patch|scale|rollout)\b|"
    r"\bgh\s+(?:pr\s+(?:create|merge|close|comment|edit|checkout)|issue\s+(?:create|close|comment|edit)|"
    r"release\s+create|repo\s+(?:create|delete|clone|fork)|workflow\s+run)\b|"
    r"\bhermes\s+(?:plugins\s+(?:install|remove|enable|disable|update)|cron|config\s+set|update)\b|"
    r"\bsudo\b|\bsu\b|\bdel\b|\berase\b|\brd\s+/|\bren\b)"
)


def _orchestrator_terminal_allowed(command: str) -> bool:
    """True when *command* is safe for orchestrator mode.

    The orchestrator may run code/tests/builds and inspect, but must not mutate
    the workspace. Hard mutations (file writes, package installs, git mutations,
    service control, privilege escalation) are blocked; everything else —
    running the project's code and tests, plus read-only inspection — is allowed.
    """
    if not command.strip():
        return False
    return _ORCH_HARD_MUTATING_RE.search(command) is None


def orchestrator_enforcement_enabled() -> bool:
    """Orchestrator-mode enforcement is on unless explicitly switched off."""
    return str(os.environ.get("HERMES_COMPOSER_MODES_ORCHESTRATE_ENFORCE", "1")).strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def _orch_task_goals(args: object) -> list[str]:
    """The goal strings of a delegate_task call (empty if the shape is unknown)."""
    if not isinstance(args, dict):
        return []
    tasks = args.get("tasks")
    if not isinstance(tasks, list):
        return []
    return [
        str(t["goal"])
        for t in tasks
        if isinstance(t, dict) and isinstance(t.get("goal"), str)
    ]


def orchestrator_block_message(tool_name: str, args: object) -> str | None:
    """The block message for a tool call orchestrator mode must refuse, or ``None``."""
    if not orchestrator_enforcement_enabled():
        return None
    if not tool_name:
        return None
    name = str(tool_name)
    door_out = (
        " If the request needs code changed, delegate it to a subagent with delegate_task, or "
        "tell the user to re-ask in Agent mode."
    )
    if name == _ORCH_DELEGATE_TOOL:
        goals = _orch_task_goals(args)
        if not goals:
            return None  # unrecognized args shape — don't block on shape
        missing = [g[:60] for g in goals if role_from_goal(g) is None]
        if missing:
            return (
                "[composer-modes] Orchestrator mode: every subagent goal must begin with its "
                "role tag — [ROLE: planner], [ROLE: implementer] or [ROLE: debugger] — followed "
                "by that role's brief, so the subagent knows its job. The dispatch was blocked "
                "before any subagent ran. Re-send the delegate_task call with a role tag on "
                "every goal. Offending goal(s): " + " | ".join(missing)
            )
        return None
    if name == "terminal":
        command = ""
        if isinstance(args, dict):
            command = str(args.get("command") or "")
        if _orchestrator_terminal_allowed(command):
            return None
        return (
            f"[composer-modes] Orchestrator mode may run code and tests but not mutate the "
            f"workspace: the terminal command was blocked because it writes/deletes/moves files, "
            f"installs packages, or mutates git. Run the code/tests to verify, inspect with "
            f"read-only commands, and delegate any needed code change to a subagent." + door_out
        )
    if name in DENY_TOOLS or _MUTATING_NAME_RE.search(name):
        return (
            f"[composer-modes] Orchestrator mode may run code and delegate, but not edit: the "
            f"tool '{name}' changes state, so the call was blocked before it ran. Nothing was "
            f"written. Delegate the code change to a subagent with delegate_task." + door_out
        )
    return None
