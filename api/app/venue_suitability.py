"""SCRUM-29: venue suitability engine and rules (OOP core)."""

from abc import ABC, abstractmethod
from typing import Any

# ---------------------------------------------------------------------------
# Text normalisation
#
# Coordinators type requirements into free-text fields, so a venue's
# canonical feature names ("u-shape", "boardroom") can be written many ways
# ("u shaped", "board room", "wheel chair"). Naive substring matching silently
# misses these variants. We normalise both sides before comparing so the check
# is robust, and we keep track of near-misses so they can be flagged.
# ---------------------------------------------------------------------------

# Spelling variants that should resolve to the same canonical token.
# Canonical forms keep their spaces (e.g. "u shape") so whole-phrase matching
# works; collapsing them into one underscore token ("u_shape") would let a
# substring like "shape" or "access" falsely match.
_SYNONYMS: dict[str, str] = {
    "theater": "theatre",
    "u shaped": "u shape",
    "u-shape": "u shape",
    "u shaped seating": "u shape",
    "board room": "boardroom",
    "board-room": "boardroom",
    "wheel chair": "wheelchair",
    "wheel-chair": "wheelchair",
    "sound system": "sound system",
    "sound-system": "sound system",
    "accessible toilet": "accessible toilet",
    "accessible-toilet": "accessible toilet",
    "hearing loop": "hearing loop",
    "hearing-loop": "hearing loop",
    "wifi": "wifi",
    "wi-fi": "wifi",
}


def _normalise(text: str) -> str:
    """Lower-case, collapse whitespace, strip hyphens, apply spelling synonyms."""
    normalised = " ".join((text or "").lower().split())
    normalised = normalised.replace("-", " ")
    for variant, canonical in _SYNONYMS.items():
        normalised = normalised.replace(variant, canonical)
    return " ".join(normalised.split())


def _tokens(text: str) -> set[str]:
    """Split normalised text into individual words, dropping short noise."""
    return {tok for tok in _normalise(text).split() if len(tok) > 2}


def _ngrams(text: str, size: int) -> list[str]:
    """Sliding window of `size` tokens over the normalised text."""
    words = text.split()
    return [" ".join(words[i : i + size]) for i in range(len(words) - size + 1)]


def find_requested(canonical: str, request_text: str) -> tuple[bool, str | None]:
    """
    Decide whether the coordinator's free-text request mentions `canonical`.

    Returns (found, hint):
      - (True, None)  — an exact or normalised-variant match (synonyms, hyphens,
                        spacing). The venue is then checked for that feature.
      - (False, None) — the feature is not mentioned at all; nothing to flag.
      - (False, hint) — the wording is a near-miss typo of `canonical`, so the
                        coordinator should fix it before we trust it as a
                        requirement.

    Matching is tried in order: whole-phrase match, then single-token substring
    (multi-word canonicals are skipped here to avoid false positives such as
    "access" matching "accessible"), then a conservative near-miss check that
    only reports typos at edit distance 1 on tokens of length 5 or more.
    """
    req_norm = _normalise(request_text)
    canonical_norm = _normalise(canonical)
    if not canonical_norm:
        return False, None

    # 1. Whole-phrase match (handles multi-word features and normalised variants).
    if canonical_norm in req_norm:
        return True, None

    # 2. Single-token canonical: allow a token to be a substring of a request word.
    if " " not in canonical_norm:
        for word in _tokens(request_text):
            if canonical_norm in word or word in canonical_norm:
                return True, None

    # 3. Near-miss: obvious single-character typos on longer tokens.
    #    Conservative on purpose: distance must be exactly 1 and the lengths must
    #    differ by at most 1, so genuinely ambiguous pairs — e.g. "seating" vs
    #    "stage" (distance 2) or "lyout" vs "banquet" (distance 2) — do not
    #    produce a misleading "did you mean" hint. Real typos like "projrctor",
    #    "banqet" and "microfone" (distance 1, length diff <= 1) are still caught.
    if " " not in canonical_norm and len(canonical_norm) >= 5:
        best = None
        for word in _tokens(request_text):
            if len(word) < 5:
                continue
            dist = _levenshtein(word, canonical_norm)
            if dist == 1 and abs(len(word) - len(canonical_norm)) <= 1:
                if best is None or word < best:
                    best = word
        if best:
            return False, f"Did you mean '{_display(canonical)}'?"
    return False, None


def _levenshtein(a: str, b: str) -> int:
    """Classic dynamic-programming edit distance."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, start=1):
            cur[j] = min(
                prev[j] + 1,
                cur[j - 1] + 1,
                prev[j - 1] + (ca != cb),
            )
        prev = cur
    return prev[len(b)]


def _display(name: str) -> str:
    """Pretty-print a vocabulary token for human-readable flags (e.g. u-shape -> U-shape)."""
    return name.replace("-", " ").title() if name else name


def _matches_any(canonical: str, available: list[str]) -> bool:
    """True if the venue's list contains the canonical feature (normalised)."""
    canon = _normalise(canonical)
    for item in available:
        item_norm = _normalise(item)
        if canon == item_norm or canon in item_norm or item_norm in canon:
            return True
    return False


def near_miss_hints(request_text: str, available: list[str]) -> list[str]:
    """Flag coordinator wording that is almost one of the venue's features.

    Returns hints of the form "'banquet lyout' -> Did you mean 'Banquet'?". Only
    single-token near-misses are reported, to avoid noisy false hints.
    """
    hints: list[str] = []
    avail_norm = [_normalise(a) for a in available if isinstance(a, str)]
    seen: set[str] = set()
    for word in _tokens(request_text):
        if len(word) < 5:
            continue
        for avail in avail_norm:
            if " " in avail or len(avail) < 5:
                continue
            dist = _levenshtein(word, avail)
            if dist == 1 and abs(len(word) - len(avail)) <= 1:
                hint = f"'{word}' -> Did you mean '{_display(avail)}'?"
                if hint not in seen:
                    seen.add(hint)
                    hints.append(hint)
    return hints


def _evaluate_feature_rule(
    request_text: str,
    vocabulary: list[str],
    available: list[str],
    missing_prefix: str,
) -> str | None:
    """Shared body for the layout / facility / accessibility rules.

    For each canonical feature in `vocabulary`: if the coordinator's free-text
    mentions it, check the venue has it and flag it as missing otherwise. Near
    miss typos are surfaced as "did you mean" hints rather than dropped.
    """
    missing: list[str] = []
    for feature in vocabulary:
        found, _ = find_requested(feature, request_text)
        if not found:
            continue
        if not _matches_any(feature, available):
            missing.append(feature)
    hints = near_miss_hints(request_text, available)

    if not missing and not hints:
        return None

    parts: list[str] = []
    if missing:
        parts.append(
            f"{missing_prefix} {', '.join(_display(f) for f in missing)}."
        )
    if hints:
        parts.append(" ".join(hints))
    return " ".join(parts)


# Canonical vocabulary the coordinator's free-text may express. Normalisation
# maps variants (theater, u-shaped, board room, ...) onto these tokens.
LAYOUT_VOCABULARY: list[str] = [
    "banquet",
    "theatre",
    "classroom",
    "boardroom",
    "u-shape",
    "reception",
    "hollow square",
]

FACILITY_VOCABULARY: list[str] = [
    "projector",
    "stage",
    "sound system",
    "microphone",
    "wifi",
    "whiteboard",
    "podium",
]

ACCESSIBILITY_VOCABULARY: list[str] = [
    "wheelchair",
    "elevator",
    "lift",
    "ramp",
    "accessible toilet",
    "hearing loop",
]


class SuitabilityRule(ABC):
    """
    Abstract Base Class (blueprint) for all venue suitability rules.
    Every custom rule must inherit from this class and implement evaluate.
    """

    @abstractmethod
    def evaluate(self, event: dict[str, Any], venue: dict[str, Any]) -> str | None:
        """
        Evaluate an event against a venue.

        Returns:
            A string warning flag if the venue is unsuitable under this rule,
            or None if the venue passes this rule.
        """
        pass  # pragma: no cover


class CapacityRule(SuitabilityRule):
    """Rule 1: expected attendance against venue capacity."""

    def evaluate(self, event: dict[str, Any], venue: dict[str, Any]) -> str | None:
        expected_attendance = event.get("expected_attendance")
        venue_capacity = venue.get("capacity")

        # Skip safely if attendance or capacity is missing
        if expected_attendance is None or venue_capacity is None:
            return None

        try:
            attendance = int(expected_attendance)
            capacity = int(venue_capacity)
        except (ValueError, TypeError):
            return None

        if attendance > capacity:
            excess = attendance - capacity
            return (
                f"Expected attendance ({attendance} pax) exceeds venue capacity "
                f"({capacity} pax) by {excess} pax."
            )

        return None


class LayoutRule(SuitabilityRule):
    """Rule 2: requested layouts against the venue's supported layouts."""

    def evaluate(self, event: dict[str, Any], venue: dict[str, Any]) -> str | None:
        req_text = event.get("venue_requirements") or ""
        if not _normalise(req_text):
            return None

        supported = [s for s in (venue.get("supported_layouts") or []) if isinstance(s, str)]
        layouts_str = ", ".join(supported) if supported else "None"

        # Each canonical layout is checked against the venue's list. Near-miss
        # typos (e.g. "banquet lyout") are surfaced as hints rather than dropped.
        return _evaluate_feature_rule(
            req_text,
            LAYOUT_VOCABULARY,
            supported,
            f"Requested layout(s) not listed in the venue's supported layouts "
            f"({layouts_str}):",
        )


class FacilityRule(SuitabilityRule):
    """Rule 3: requested facilities against the venue's facilities."""

    def evaluate(self, event: dict[str, Any], venue: dict[str, Any]) -> str | None:
        v_req = event.get("venue_requirements") or ""
        e_req = event.get("equipment_requirements") or ""
        req_text = (v_req + " " + e_req)
        if not _normalise(req_text):
            return None

        available = [f for f in (venue.get("facilities") or []) if isinstance(f, str)]

        # Each canonical facility is checked against the venue's list. Near-miss
        # typos (e.g. "projrctor") are surfaced as hints rather than dropped.
        return _evaluate_feature_rule(
            req_text,
            FACILITY_VOCABULARY,
            available,
            "Missing required facility feature(s):",
        )


class AccessibilityRule(SuitabilityRule):
    """Rule 4: requested accessibility features against the venue's features."""

    def evaluate(self, event: dict[str, Any], venue: dict[str, Any]) -> str | None:
        access_text = event.get("accessibility_requirements") or ""
        norm = _normalise(access_text)
        # "none" / "n/a" means no accessibility needs — nothing to check.
        if not norm or norm in ("none", "n/a", "no accessibility requirements"):
            return None

        available = [a for a in (venue.get("accessibility") or []) if isinstance(a, str)]

        # Each canonical accessibility feature is checked against the venue's
        # list. Near-miss typos (e.g. "wheel chaier") are surfaced as hints.
        return _evaluate_feature_rule(
            access_text,
            ACCESSIBILITY_VOCABULARY,
            available,
            "Missing required accessibility feature(s):",
        )


class SuitabilityEngine:
    """
    Composite Engine that orchestrates multiple SuitabilityRule objects.
    Runs an Event and Venue through all configured rules and returns an overall report.
    """

    def __init__(self, rules: list[SuitabilityRule] | None = None):
        self.rules = (
            rules
            if rules is not None
            else [
                CapacityRule(),
                LayoutRule(),
                FacilityRule(),
                AccessibilityRule(),
            ]
        )

    def add_rule(self, rule: SuitabilityRule) -> None:
        """Register an additional rule (e.g. OverlapRule for SCRUM-33)."""
        self.rules.append(rule)

    def evaluate_suitability(
        self, event: dict[str, Any], venue: dict[str, Any]
    ) -> dict[str, Any]:
        """Run every registered rule and return the overall suitability report."""
        flags: list[str] = []

        for rule in self.rules:
            flag = rule.evaluate(event, venue)
            if flag is not None:
                flags.append(flag)

        return {
            "is_suitable": len(flags) == 0,
            "flags": flags,
            "checked_rules_count": len(self.rules),
        }

