"""One soft-preference score shared by generation, preview and dashboard.
Hard conflicts and session coverage are reported separately.
"""
from db.models import SoftConstraint
from services.time_slots import get_active_slots

def penalty_minimize_gaps(entries, slots):
    if not entries or not slots:
        return 0
    groups = {}
    for e in entries:
        for g in e.get("attendee_groups", [e.get("group_code")]):
            if g:
                groups.setdefault((g, e["day"]), []).append(e["time_slot"])

    total_gap = 0
    total_sessions = 0
    for _, ss in groups.items():
        total_sessions += len(ss)
        if len(ss) < 2:
            continue
        idxs = sorted({slots.index(s) for s in ss if s in slots})
        if len(idxs) < 2:
            continue
        span = idxs[-1] - idxs[0] + 1
        total_gap += (span - len(idxs))

    if total_sessions == 0:
        return 0
    ratio = total_gap / total_sessions
    return min(round(ratio * 150), 100)


def penalty_avoid_early_mornings(entries, slots):
    if not entries or not slots:
        return 0
    first = slots[0]
    count = sum(1 for e in entries if e["time_slot"] == first)
    ratio = count / len(entries)
    return min(round(ratio * 200), 100)


def penalty_avoid_late_evenings(entries, slots):
    if not entries or not slots:
        return 0
    last = slots[-1]
    count = sum(1 for e in entries if e["time_slot"] == last)
    ratio = count / len(entries)
    return min(round(ratio * 200), 100)


def penalty_compact_days(entries, slots):
    if not entries:
        return 0
    groups = {}
    for e in entries:
        for g in e.get("attendee_groups", [e.get("group_code")]):
            if g:
                groups.setdefault(g, set()).add(e["day"])
    if not groups:
        return 0
    avg_days = sum(len(d) for d in groups.values()) / len(groups)
    excess = max(0, avg_days - 3)
    return min(round(excess * 40), 100)


PENALTY_FNS = {
    "minimize_gaps": penalty_minimize_gaps,
    "avoid_early_mornings": penalty_avoid_early_mornings,
    "avoid_late_evenings": penalty_avoid_late_evenings,
    "compact_days": penalty_compact_days,
}



def score_schedule(db, entries):
    slots = get_active_slots(db)
    rows = {r.constraint_key: r for r in db.query(SoftConstraint).all()}
    breakdown = []
    total_penalty = 0
    for key, fn in PENALTY_FNS.items():
        row = rows.get(key)
        if not row or not row.is_enabled or not row.weight:
            continue
        raw = fn(entries, slots)
        weighted = raw * row.weight / 10
        total_penalty += weighted
        breakdown.append({"constraint_key": key, "display_name": row.display_name,
                          "weight": row.weight, "raw_penalty": raw,
                          "weighted_penalty": round(weighted, 2)})
    return {"score": max(0, round(100 - total_penalty, 2)) if entries else 0,
            "total_penalty": round(total_penalty, 2), "breakdown": breakdown}


def saved_entries(entries):
    result = []
    for e in entries:
        if not e.group or not e.time_slot:
            continue
        base = e.group.group_code
        groups = ([f"{base}-{e.sub_group}"] if e.sub_group else
                  [f"{base}-{i}" for i in range(1, max(e.group.sub_group_count, 1) + 1)])
        result.append({"day": e.day, "time_slot": e.time_slot.slot_label,
                       "group_code": base, "attendee_groups": groups})
    return result
