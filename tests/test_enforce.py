"""Tests for ask-mode enforcement (policy gate, not a sandbox)."""
from __future__ import annotations

import pytest

from enforce import ask_block_message, ask_enforcement_enabled


@pytest.fixture()
def enabled(monkeypatch):
    monkeypatch.delenv("HERMES_COMPOSER_MODES_ASK_ENFORCE", raising=False)


# ── tools ────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("tool", ["write_file", "patch", "delegate_task", "memory", "cronjob_manage"])
def test_state_changing_tools_are_blocked(enabled, tool):
    assert ask_block_message(tool, {}) is not None


@pytest.mark.parametrize("tool", ["read_file", "search_files", "web_search", "web_extract", "vision_analyze"])
def test_read_only_tools_pass(enabled, tool):
    assert ask_block_message(tool, {}) is None


@pytest.mark.parametrize("tool", ["file_delete", "repo_create", "image_upload", "save_note"])
def test_mutating_name_shapes_are_blocked(enabled, tool):
    assert ask_block_message(tool, {}) is not None


def test_block_message_names_the_tool_and_the_door_out(enabled):
    message = ask_block_message("write_file", {})
    assert "write_file" in message
    assert "read-only" in message
    assert "Ask closing sentence" in message


# ── terminal ─────────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "command",
    [
        "ls -la",
        "git status --short",
        "git log --oneline -5",
        "cat README.md",
        "sed -n '1,20p' plugin.js",
        "rg --files | head -20",
        "find . -name '*.py'",
        "grep -rn 'note' modes.py",
        "wc -l desktop/plugin.js",
        "python --version",
        "npm ls --depth=0",
        "gh pr view 12",
        "ls | wc -l",
    ],
)
def test_read_only_commands_are_allowed(enabled, command):
    assert ask_block_message("terminal", {"command": command}) is None


@pytest.mark.parametrize(
    "command",
    [
        "rm -rf build",
        "echo hi > file.txt",
        "cat a >> b",
        "mv a b",
        "cp a b",
        "mkdir newdir",
        "touch new.txt",
        "npm install",
        "npm run build",
        "pip install requests",
        "git commit -m x",
        "git checkout -b feature",
        "git apply patch.diff",
        "sed -i 's/a/b/' file.txt",
        "python -c 'open(\"x\",\"w\")'",
        "ls && rm -rf tmp",
        "cat file | tee out.txt",
        "dd if=/dev/zero of=file",
        "find . -name '*.tmp' -delete",
        "hermes plugins install owner/repo",
        "curl -o out.html https://example.com",
        "ls; echo done > log",
        "",
    ],
)
def test_mutating_or_ambiguous_commands_are_blocked(enabled, command):
    assert ask_block_message("terminal", {"command": command}) is not None


def test_terminal_with_missing_command_is_blocked(enabled):
    assert ask_block_message("terminal", {}) is not None
    assert ask_block_message("terminal", None) is not None


def test_unknown_tool_is_left_alone(enabled):
    assert ask_block_message("mystery_tool", {"a": 1}) is None


def test_empty_tool_name_is_ignored(enabled):
    assert ask_block_message("", {}) is None


# ── kill switch ──────────────────────────────────────────────────────────────
@pytest.mark.parametrize("value", ["0", "false", "off", "no"])
def test_enforcement_can_be_switched_off(monkeypatch, value):
    monkeypatch.setenv("HERMES_COMPOSER_MODES_ASK_ENFORCE", value)
    assert not ask_enforcement_enabled()
    assert ask_block_message("write_file", {}) is None
    assert ask_block_message("terminal", {"command": "rm -rf dist"}) is None


@pytest.mark.parametrize("value", ["1", "true", "yes", "on", ""])
def test_enforcement_is_on_by_default(monkeypatch, value):
    monkeypatch.setenv("HERMES_COMPOSER_MODES_ASK_ENFORCE", value)
    assert ask_enforcement_enabled()


# ── Plan mode ────────────────────────────────────────────────────────────────
from enforce import plan_block_message, plan_enforcement_enabled  # noqa: E402


@pytest.fixture()
def plan_enabled(monkeypatch):
    monkeypatch.delenv("HERMES_COMPOSER_MODES_PLAN_ENFORCE", raising=False)


# plan files are the one thing plan mode may write
@pytest.mark.parametrize(
    "path",
    [
        ".hermes/plans/2026-01-01_120000-add-auth.md",
        ".hermes/plans/2026-01-01_120000-add-auth-questions.json",
        ".hermes/plans/sub/dir/plan.md",
        ".hermes/plans/../plans/plan.md",  # resolves back into plans/
    ],
)
def test_plan_file_writes_are_allowed(plan_enabled, path):
    assert plan_block_message("write_file", {"path": path}) is None
    assert plan_block_message("patch", {"path": path}) is None


# writing anywhere else is blocked
@pytest.mark.parametrize(
    "path",
    [
        "src/models/user.py",
        "README.md",
        ".hermes/plans",  # the directory itself, not a file inside it
        ".hermes/other/plan.md",
        "plans/plan.md",  # missing the .hermes prefix
        "../.hermes/plans/plan.md",  # escapes above the workspace root
        "/home/user/.hermes/plans/plan.md",  # absolute
        "~/.hermes/plans/plan.md",  # home-relative
        "",
        None,
    ],
)
def test_non_plan_writes_are_blocked(plan_enabled, path):
    assert plan_block_message("write_file", {"path": path}) is not None


def test_plan_write_missing_path_is_blocked(plan_enabled):
    assert plan_block_message("write_file", {}) is not None


# other state-changing tools are blocked
@pytest.mark.parametrize("tool", ["patch", "delegate_task", "memory", "cronjob_manage", "file_delete"])
def test_plan_state_changing_tools_are_blocked(plan_enabled, tool):
    assert plan_block_message(tool, {}) is not None


# read-only tools pass
@pytest.mark.parametrize("tool", ["read_file", "search_files", "vision_analyze", "mystery_tool"])
def test_plan_read_only_tools_pass(plan_enabled, tool):
    assert plan_block_message(tool, {}) is None


# terminal: read-only + mkdir -p .hermes/plans pass, the rest is blocked
@pytest.mark.parametrize(
    "command",
    ["ls -la", "git status", "cat README.md", "mkdir -p .hermes/plans", "mkdir .hermes/plans"],
)
def test_plan_allowed_terminal_commands(plan_enabled, command):
    assert plan_block_message("terminal", {"command": command}) is None


@pytest.mark.parametrize(
    "command",
    [
        "rm -rf build",
        "echo hi > file.txt",
        "npm install",
        "git commit -m x",
        "mkdir -p other",
        "mkdir -p /tmp/plans",
        "mkdir -p .hermes/plans && rm -rf x",
        "",
    ],
)
def test_plan_blocked_terminal_commands(plan_enabled, command):
    assert plan_block_message("terminal", {"command": command}) is not None


def test_plan_block_message_names_the_tool(plan_enabled):
    message = plan_block_message("write_file", {"path": "src/x.py"})
    assert message is not None
    assert "write_file" in message
    assert ".hermes/plans" in message


# kill switch
@pytest.mark.parametrize("value", ["0", "false", "off", "no"])
def test_plan_enforcement_can_be_switched_off(monkeypatch, value):
    monkeypatch.setenv("HERMES_COMPOSER_MODES_PLAN_ENFORCE", value)
    assert not plan_enforcement_enabled()
    assert plan_block_message("write_file", {"path": "src/x.py"}) is None
    assert plan_block_message("terminal", {"command": "rm -rf dist"}) is None


@pytest.mark.parametrize("value", ["1", "true", "yes", "on", ""])
def test_plan_enforcement_is_on_by_default(monkeypatch, value):
    monkeypatch.setenv("HERMES_COMPOSER_MODES_PLAN_ENFORCE", value)
    assert plan_enforcement_enabled()


# ── Orchestrator mode ────────────────────────────────────────────────────────
from enforce import orchestrator_block_message, orchestrator_enforcement_enabled  # noqa: E402


@pytest.fixture()
def orch_enabled(monkeypatch):
    monkeypatch.delenv("HERMES_COMPOSER_MODES_ORCHESTRATE_ENFORCE", raising=False)


def test_orchestrator_allows_delegate_task(orch_enabled):
    assert orchestrator_block_message("delegate_task", {}) is None


@pytest.mark.parametrize("tool", ["read_file", "search_files", "vision_analyze", "mystery_tool"])
def test_orchestrator_read_only_tools_pass(orch_enabled, tool):
    assert orchestrator_block_message(tool, {}) is None


@pytest.mark.parametrize("tool", ["write_file", "patch", "memory", "cronjob_manage", "file_delete"])
def test_orchestrator_state_changing_tools_blocked(orch_enabled, tool):
    assert orchestrator_block_message(tool, {}) is not None


# the orchestrator MAY run code and tests to verify
@pytest.mark.parametrize(
    "command",
    [
        "python -m pytest -q",
        "pytest tests/",
        "npm test",
        "npm run test",
        "node src/index.js",
        "python src/main.py",
        "cargo test",
        "go test ./...",
        "ls -la",
        "git status",
        "cat README.md",
    ],
)
def test_orchestrator_execution_and_read_only_pass(orch_enabled, command):
    assert orchestrator_block_message("terminal", {"command": command}) is None


# the orchestrator must NOT mutate the workspace
@pytest.mark.parametrize(
    "command",
    [
        "npm install",
        "pip install requests",
        "rm -rf dist",
        "echo x > f.py",
        "sed -i 's/a/b/' f.py",
        "git commit -m x",
        "git push",
        "mv a b",
        "mkdir build",
        "sudo apt update",
        "docker build -t x .",
        "",
    ],
)
def test_orchestrator_mutations_blocked(orch_enabled, command):
    assert orchestrator_block_message("terminal", {"command": command}) is not None


def test_orchestrator_block_message_is_a_reminder(orch_enabled):
    # the block message must explain WHY it wasn't permitted and suggest an
    # alternative — this is the injected reminder on a disallowed action
    message = orchestrator_block_message("write_file", {})
    assert message is not None
    assert "write_file" in message
    assert "blocked" in message.lower()  # why: the call was refused
    assert "delegate" in message.lower()  # what to do instead


@pytest.mark.parametrize("value", ["0", "false", "off", "no"])
def test_orchestrator_enforcement_can_be_switched_off(monkeypatch, value):
    monkeypatch.setenv("HERMES_COMPOSER_MODES_ORCHESTRATE_ENFORCE", value)
    assert not orchestrator_enforcement_enabled()
    assert orchestrator_block_message("write_file", {}) is None
    assert orchestrator_block_message("terminal", {"command": "rm -rf x"}) is None
