import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import openpyxl


def normalize(value):
    return re.sub(r"\s+", " ", str(value or "").strip()).casefold()


def number(value):
    return float(value or 0)


def read_json(path):
    with Path(path).open("r", encoding="utf-8") as stream:
        return json.load(stream)


def alias_index(records):
    index = {}
    for record in records:
        if record.get("deleted"):
            continue
        for value in [record.get("name")] + list(record.get("sourceValues") or []):
            key = normalize(value)
            if key:
                index[key] = record.get("name")
    return index


def facts_from_source(path):
    sheet = openpyxl.load_workbook(path, read_only=True, data_only=True).active
    employee = ""
    facts = defaultdict(lambda: [0.0] * 7)
    for row in sheet.iter_rows(min_row=6, values_only=True):
        label = str(row[0] or "").strip()
        if not label:
            continue
        if re.match(r"^20\d{2}-", label):
            values = [number(value) for value in row[14:21]]
            if employee and any(values):
                facts[(employee, label)] = [facts[(employee, label)][index] + values[index] for index in range(7)]
        else:
            employee = label
    return facts


def main():
    source_path = sys.argv[1]
    project_root = Path(sys.argv[2])
    directories = read_json(project_root / "data" / "reference-overrides.json")["directories"]
    teams = read_json(project_root / "data" / "team-overrides.json")["records"]
    staff = read_json(project_root / "data" / "staff-overrides.json")["records"]
    resources = alias_index(directories["resources"])
    projects = alias_index(directories["projects"])
    canonical_resource = lambda value: resources.get(normalize(value), value)
    canonical_project = lambda value: projects.get(normalize(value), value)

    expected = defaultdict(lambda: [0.0] * 7)
    for (employee, project), hours in facts_from_source(source_path).items():
        key = (normalize(canonical_resource(employee)), normalize(canonical_project(project)))
        expected[key] = [expected[key][index] + hours[index] for index in range(7)]
    source_pair_count = len(expected)

    actual = defaultdict(lambda: [0.0] * 7)
    for record in staff:
        if record.get("archived"):
            continue
        key = (normalize(canonical_resource(record.get("employee"))), normalize(canonical_project(record.get("project"))))
        months = (record.get("hoursActual") or {}).get("2026", {})
        actual[key] = [actual[key][index] + number(months.get(str(index + 1))) for index in range(7)]

    differences = []
    for key in sorted(set(expected) | set(actual)):
        source_values = expected[key]
        target_values = actual[key]
        if any(abs(left - right) > 0.00001 for left, right in zip(source_values, target_values)):
            differences.append({"employee": key[0], "project": key[1], "source": source_values, "application": target_values})

    plan_errors = []
    for record in teams:
        if record.get("archived"):
            continue
        for year in ("2024", "2025", "2026"):
            for month in range(1, 13):
                if number((record.get("hoursPlan") or {}).get(year, {}).get(str(month))) != 168:
                    plan_errors.append({"id": record.get("id"), "year": year, "month": month})

    print(json.dumps({
        "sourcePairs": source_pair_count, "applicationPairsWithActualHours": sum(any(values) for values in actual.values()), "sourceHoursJanJul2026": sum(sum(item) for item in expected.values()),
        "applicationHoursJanJul2026": sum(sum(item) for item in actual.values()), "differences": differences,
        "teamRecords": len([item for item in teams if not item.get("archived")]), "planErrors": plan_errors
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
