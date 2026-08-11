import json
import sys
from collections import defaultdict
from pathlib import Path


YEARS = ("2024", "2025", "2026")
MONTHS = tuple(str(month) for month in range(1, 13))


def num(value):
    return float(value or 0)


def read_json(path):
    with Path(path).open("r", encoding="utf-8") as stream:
        return json.load(stream)


def normalize(value):
    return " ".join(str(value or "").casefold().split())


def values():
    return {"annual": 0.0, "monthly": {"2025": {month: 0.0 for month in MONTHS}, "2026": {month: 0.0 for month in MONTHS}}}


def add(target, annual=0, monthly=None):
    target["annual"] += num(annual)
    for year in ("2025", "2026"):
        for month in MONTHS:
            target["monthly"][year][month] += num((monthly or {}).get(year, {}).get(month))


def equal(left, right):
    return abs(num(left) - num(right)) < 0.00001


def main():
    root = Path(sys.argv[1])
    data = root / "data"
    report = read_json(data / "import-reports" / "hours-import-20260803.json")
    refs = read_json(data / "reference-overrides.json")["directories"]
    teams = read_json(data / "team-overrides.json")["records"]
    staff = read_json(data / "staff-overrides.json")["records"]
    subcontract = read_json(data / "subcontract-overrides.json")["records"]
    vendors = {normalize(item.get("name")): item.get("providerType") for item in refs["vendors"] if not item.get("deleted")}
    resources = {normalize(item.get("name")): item for item in refs["resources"] if not item.get("deleted")}

    expected = defaultdict(values)
    for item in report["resolutions"]:
        key = (normalize(item["targetEmployee"]), normalize(item["targetProject"]))
        add(expected[key], item["hours"].get("annual"), item["hours"].get("monthly"))

    plan_pairs = defaultdict(values)
    for record in teams:
        if record.get("archived"):
            continue
        key = (normalize(record.get("employee")), normalize(record.get("project")))
        annual = num((record.get("hoursPlanAnnual") or {}).get("2024"))
        monthly = {year: {month: num((record.get("hoursPlan") or {}).get(year, {}).get(month)) for month in MONTHS} for year in ("2025", "2026")}
        add(plan_pairs[key], annual, monthly)

    staff_pairs = defaultdict(values)
    for record in staff:
        if record.get("archived"):
            continue
        resource = resources.get(normalize(record.get("employee")))
        if not resource or vendors.get(normalize(resource.get("vendor"))) != "Штат":
            continue
        key = (normalize(record.get("employee")), normalize(record.get("project")))
        annual = num((record.get("hoursActualAnnual") or {}).get("2024"))
        monthly = {year: {month: num((record.get("hoursActual") or {}).get(year, {}).get(month)) for month in MONTHS} for year in ("2025", "2026")}
        add(staff_pairs[key], annual, monthly)

    contractor_pairs = defaultdict(values)
    for record in subcontract:
        if record.get("archived"):
            continue
        resource = resources.get(normalize(record.get("resource")))
        if not resource or vendors.get(normalize(resource.get("vendor"))) != "Подряд":
            continue
        key = (normalize(record.get("resource")), normalize(record.get("project")))
        period = str(record.get("period", "")).split("-")
        if len(period) != 2:
            continue
        year, month = period
        if year == "2024":
            contractor_pairs[key]["annual"] += num((record.get("annualActualHours") or {}).get("2024"))
        if year in ("2025", "2026"):
            contractor_pairs[key]["monthly"][year][str(int(month))] += num(record.get("actualHours"))

    def compare(left, right, include_future=False):
        differences = []
        for key in sorted(set(left) | set(right)):
            source_values = left[key]
            application_values = right[key]
            if not equal(source_values["annual"], application_values["annual"]):
                differences.append({"employee": key[0], "project": key[1], "year": "2024", "source": source_values["annual"], "application": application_values["annual"]})
            for year in ("2025", "2026"):
                for month in MONTHS:
                    if year == "2026" and not include_future and int(month) > 7:
                        continue
                    if not equal(source_values["monthly"][year][month], application_values["monthly"][year][month]):
                        differences.append({"employee": key[0], "project": key[1], "year": year, "month": month, "source": source_values["monthly"][year][month], "application": application_values["monthly"][year][month]})
        return differences

    expected_staff = defaultdict(values)
    expected_contractors = defaultdict(values)
    for key, item in expected.items():
        resource = resources.get(key[0])
        target = expected_contractors if resource and vendors.get(normalize(resource.get("vendor"))) == "Подряд" else expected_staff
        add(target[key], item["annual"], item["monthly"])

    expected_plan = defaultdict(values)
    for key, item in expected.items():
        add(expected_plan[key], item["annual"], item["monthly"])
        if any(item["monthly"]["2026"][month] > 0 for month in ("5", "6", "7")):
            for month in ("8", "9", "10", "11", "12"):
                expected_plan[key]["monthly"]["2026"][month] = 168

    missing = []
    for key in expected:
        if key not in plan_pairs:
            missing.append({"employee": key[0], "project": key[1], "kind": "plan"})

    future_plan_errors = []
    for record in teams:
        if record.get("archived"):
            continue
        spring_or_summer = [num((record.get("hoursPlan") or {}).get("2026", {}).get(month)) for month in ("5", "6", "7")]
        expected_future = 168 if any(value > 0 for value in spring_or_summer) else 0
        actual_future = [num((record.get("hoursPlan") or {}).get("2026", {}).get(month)) for month in ("8", "9", "10", "11", "12")]
        if any(not equal(value, expected_future) for value in actual_future):
            future_plan_errors.append(record.get("id"))

    source_hours = report.get("sourceHours", {})
    staff_total = {"2024": sum(item["annual"] for item in staff_pairs.values()), "2025": sum(sum(item["monthly"]["2025"].values()) for item in staff_pairs.values()), "2026JanJul": sum(sum(item["monthly"]["2026"][str(month)] for month in range(1, 8)) for item in staff_pairs.values())}
    contractor_total = {"2024": sum(item["annual"] for item in contractor_pairs.values()), "2025": sum(sum(item["monthly"]["2025"].values()) for item in contractor_pairs.values()), "2026JanJul": sum(sum(item["monthly"]["2026"][str(month)] for month in range(1, 8)) for item in contractor_pairs.values())}

    print(json.dumps({
        "sourceHours": source_hours, "staffHours": staff_total, "contractorHours": contractor_total,
        "combinedHours": {key: staff_total[key] + contractor_total[key] for key in source_hours},
        "planDifferences": compare(expected_plan, plan_pairs, True), "staffFactDifferences": compare(expected_staff, staff_pairs), "contractorFactDifferences": compare(expected_contractors, contractor_pairs),
        "missingPlanPairs": missing, "futurePlanErrors": future_plan_errors,
        "fuzzyMatches": len(report["fuzzyMatches"]), "sourceNamedResources": len(report["sourceNamedResources"])
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
