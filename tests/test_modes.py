"""Tests for the mode catalogue — the text and the guards the model depends on."""
from __future__ import annotations

import pytest

from modes import (
    ASK_NOTE,
    DEBUG_NOTE,
    DEFAULT_MODE,
    LABELS,
    MODE_IDS,
    NOTES,
    PLAN_NOTE,
    is_mode,
    is_slash_shaped,
    note_for,
)


def test_every_mode_has_a_label_and_agent_is_the_default():
    assert DEFAULT_MODE == "agent"
    assert set(MODE_IDS) == {"ask", "agent", "plan", "debug", "orchestrator"}
    assert set(LABELS) == set(MODE_IDS)


def test_agent_and_unknown_modes_carry_no_note():
    assert note_for("agent") is None
    assert note_for("nope") is None
    assert note_for(None) is None
    assert note_for(7) is None


@pytest.mark.parametrize("mode", ["ask", "plan", "debug", "orchestrator"])
def test_notes_are_non_empty_and_tagged(mode):
    note = note_for(mode)
    assert note and note.startswith(f"[mode:{mode}]") or note.startswith("[/plan")
    assert len(note) > 200


def test_ask_note_keeps_the_mandated_closing_sentence():
    """The owner's ask contract: the closing sentence is verbatim, only A/B/C adapts."""
    assert "I am in Ask mode, I can only answer." in ASK_NOTE
    assert "ask me to do so in Agent mode." in ASK_NOTE
    assert "Never claim or pretend to have performed an action you did not perform." in ASK_NOTE


def test_plan_note_carries_the_approval_and_questions_directives():
    assert "::plan-approve{file=" in PLAN_NOTE
    assert "::plan-questions{file=" in PLAN_NOTE
    assert ".hermes/plans/" in PLAN_NOTE


def test_orchestrator_note_mandates_delegation_and_mode_lock():
    from modes import ORCH_NOTE
    assert "delegate_task" in ORCH_NOTE
    assert "FIRST ACTION" in ORCH_NOTE  # must delegate a planner before anything else
    assert "[ROLE: planner]" in ORCH_NOTE  # subagent role tags are mandated
    assert "CANNOT change" in ORCH_NOTE  # the model cannot change its own mode


# role tag -> mode mapping (drives the subagent_start handler)
@pytest.mark.parametrize(
    "goal,role,mode",
    [
        ("[ROLE: planner] Plan X.", "planner", "plan"),
        ("[ROLE: implementer] Build X.", "implementer", "agent"),
        ("[ROLE: debugger] Fix X.", "debugger", "debug"),
        ("[role: DEBUGGER] Fix X.", "debugger", "debug"),  # case-insensitive
        ("Plan X.", None, None),  # no tag
        ("[ROLE: architect] X.", None, None),  # unknown role
    ],
)
def test_role_and_mode_from_goal(goal, role, mode):
    from modes import mode_for_goal, role_from_goal
    assert role_from_goal(goal) == role
    assert mode_for_goal(goal) == mode


def test_debug_note_carries_the_loop_directive():
    assert '::debug-loop{round="1"}' in DEBUG_NOTE
    assert "Mark as fixed" in DEBUG_NOTE


def test_notes_map_covers_exactly_the_non_agent_modes():
    assert set(NOTES) == {"ask", "plan", "debug", "orchestrator"}


@pytest.mark.parametrize(
    "text",
    ["/plan do it", "/mode ask", "/help", "/compact now"],
)
def test_slash_shaped_is_recognised(text):
    assert is_slash_shaped(text)


@pytest.mark.parametrize(
    "text",
    ["", "plan", "a /slash in the middle", "//not-a-command", "text with /plan later"],
)
def test_non_slash_shapes_are_not_commands(text):
    assert not is_slash_shaped(text)


def test_is_mode_is_strict():
    assert is_mode("ask")
    assert not is_mode("ASK")
    assert not is_mode(" agent")
