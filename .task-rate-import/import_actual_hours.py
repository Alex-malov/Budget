import hashlib
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import openpyxl


YEARS = ("2024", "2025", "2026")
FACT_YEAR = "2026"
IMPORT_MONTHS = 7
DEFAULT_ROLE = "Не определена"


def normalize(value):
    return re.sub(r"\s+", " ", str(value or "").strip()).casefold()


def number(value):
    if value is None or str(value).strip() == "":
        return 0.0
    return float(value)


def stable_id(prefix, *parts):
    source = "|".join(normalize(item) for item in parts).encode("utf-8")
    return prefix + "-" + hashlib.sha1(source).hexdigest()[:16]


def blank_months(value=0):
    return {str(month): value for month in range(1, 13)}


def default_cost_plan():
    return {year: {str(month): {"rate": 0, "attraction": 0} for month in range(1, 13)} for year in YEARS}


def default_hours_plan():
    return {year: blank_months(168) for year in YEARS}


def default_actual_hours():
    return {year: blank_months(0) for year in YEARS}


def load_json(path):
    with path.open("r", encoding="utf-8") as stream:
        return json.load(stream)


def save_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    temporary.replace(path)


def reference_index(records):
    index = {}
    for record in records:
        if record.get("deleted"):
            continue
        for value in [record.get("name")] + list(record.get("sourceValues") or []):
            key = normalize(value)
            if key:
                index[key] = record
    return index


def source_facts(source_path):
    workbook = openpyxl.load_workbook(source_path, read_only=True, data_only=True)
    sheet = workbook.active
    employee = ""
    facts = defaultdict(lambda: [0.0] * IMPORT_MONTHS)
    for row in sheet.iter_rows(min_row=6, values_only=True):
        label = str(row[0] or "").strip()
        if not label:
            continue
        if re.match(r"^20\d{2}-", label):
            if not employee:
                continue
            values = [number(value) for value in row[14:21]]
            if any(values):
                facts[(employee, label)] = [facts[(employee, label)][month] + values[month] for month in range(IMPORT_MONTHS)]
        else:
            employee = label
    return facts


def main():
    source_path = Path(sys.argv[1])
    project_root = Path(sys.argv[2])
    data_root = project_root / "data"
    reference_path = data_root / "reference-overrides.json"
    team_path = data_root / "team-overrides.json"
    staff_path = data_root / "staff-overrides.json"

    references_file = load_json(reference_path)
    directories = references_file["directories"]
    team_file = load_json(team_path)
    staff_file = load_json(staff_path)
    team_records = team_file["records"]
    staff_records = staff_file["records"]
    facts = source_facts(source_path)

    role_index = reference_index(directories["roles"])
    if DEFAULT_ROLE not in [record.get("name") for record in directories["roles"]]:
        directories["roles"].append({
            "id": stable_id("auto-role", DEFAULT_ROLE), "name": DEFAULT_ROLE, "value": "", "parent": "",
            "providerType": "", "vendor": "", "sourceKey": normalize(DEFAULT_ROLE), "sourceValues": [DEFAULT_ROLE],
            "archived": False, "deleted": False
        })
        role_index = reference_index(directories["roles"])

    resource_index = reference_index(directories["resources"])
    project_index = reference_index(directories["projects"])
    added_resources = []
    added_projects = []

    def ensure_resource(name):
        key = normalize(name)
        record = resource_index.get(key)
        if record:
            return record
        record = {
            "id": stable_id("auto-resource-hours", name), "name": name, "value": "", "parent": "", "providerType": "",
            "vendor": "ЛТ", "costPlan": default_cost_plan(), "sourceKey": key, "sourceValues": [name],
            "archived": False, "deleted": False
        }
        directories["resources"].append(record)
        resource_index[key] = record
        added_resources.append(name)
        return record

    def ensure_project(name):
        key = normalize(name)
        record = project_index.get(key)
        if record:
            return record
        record = {
            "id": stable_id("auto-project-hours", name), "name": name, "value": "", "parent": "", "providerType": "",
            "vendor": "", "sourceKey": key, "sourceValues": [name], "archived": False, "deleted": False
        }
        directories["projects"].append(record)
        project_index[key] = record
        added_projects.append(name)
        return record

    def canonical_resource(value):
        return ensure_resource(value).get("name")

    def canonical_project(value):
        return ensure_project(value).get("name")

    def known_resource(value):
        record = resource_index.get(normalize(value))
        return record.get("name") if record else value

    def known_project(value):
        record = project_index.get(normalize(value))
        return record.get("name") if record else value

    def role_for_employee(employee):
        target = normalize(employee)
        for record in team_records:
            if not record.get("archived") and normalize(record.get("employee")) == target and record.get("role"):
                return record["role"]
        for record in staff_records:
            if not record.get("archived") and normalize(record.get("employee")) == target and record.get("role"):
                return record["role"]
        return DEFAULT_ROLE

    def normalize_plan(record):
        record["hoursPlan"] = default_hours_plan()

    # The requested uniform plan is applied to all active records, including already existing team rows.
    for record in team_records:
        if not record.get("archived"):
            normalize_plan(record)

    # The supplied file is authoritative for 2026: reset the year before distributing all source facts.
    for record in staff_records:
        actual = record.setdefault("hoursActual", {})
        actual[FACT_YEAR] = blank_months(0)

    team_by_pair = defaultdict(list)
    for record in team_records:
        if record.get("archived") or record.get("source") != "Штат":
            continue
        team_by_pair[(normalize(known_resource(record.get("employee"))), normalize(known_project(record.get("project"))))].append(record)

    staff_by_pair = defaultdict(list)
    for record in staff_records:
        if record.get("archived"):
            continue
        staff_by_pair[(normalize(known_resource(record.get("employee"))), normalize(known_project(record.get("project"))))].append(record)

    added_team = 0
    added_staff = 0
    imported = []
    for (source_employee, source_project), values in sorted(facts.items()):
        employee = canonical_resource(source_employee)
        project = canonical_project(source_project)
        # The source contains employee time facts for the staff register.  A source employee must therefore be
        # linked to the staff supplier so that the row stays visible in «Суммы и часы штат».
        resource = resource_index[normalize(source_employee)]
        resource["vendor"] = "ЛТ"
        pair = (normalize(employee), normalize(project))
        role = role_for_employee(employee)
        team_candidates = team_by_pair[pair]
        if not team_candidates:
            team_record = {
                "id": stable_id("auto-team-hours", employee, project), "employee": employee, "vendor": "ЛТ", "project": project,
                "role": role, "source": "Штат", "origin": "nsi-sync", "archived": False, "hoursPlan": default_hours_plan(),
                "rate": 0, "attraction": 0, "cost": 0
            }
            team_records.append(team_record)
            team_by_pair[pair].append(team_record)
            team_candidates = team_by_pair[pair]
            added_team += 1
        else:
            role = team_candidates[0].get("role") or role

        candidates = staff_by_pair[pair]
        if not candidates:
            staff_record = {
                "id": stable_id("auto-staff-hours", employee, project), "employee": employee, "project": project, "role": role,
                "group": "Автоматически из НСИ", "cost": 0, "origin": "nsi-sync", "archived": False,
                "hoursPlan": default_hours_plan(), "hoursActual": default_actual_hours()
            }
            staff_records.append(staff_record)
            staff_by_pair[pair].append(staff_record)
            candidates = staff_by_pair[pair]
            added_staff += 1

        target = candidates[0]
        actual = target.setdefault("hoursActual", {})
        actual[FACT_YEAR] = blank_months(0)
        for index, value in enumerate(values, start=1):
            actual[FACT_YEAR][str(index)] = value
        imported.append({"employee": employee, "project": project, "total": sum(values), "staffId": target["id"]})

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    references_file["updatedAt"] = now
    team_file["updatedAt"] = now
    staff_file["updatedAt"] = now
    save_json(reference_path, references_file)
    save_json(team_path, team_file)
    save_json(staff_path, staff_file)

    print(json.dumps({
        "sourcePairs": len(facts), "sourceHours": sum(sum(values) for values in facts.values()), "importedPairs": len(imported),
        "importedHours": sum(item["total"] for item in imported), "addedResources": len(added_resources), "addedProjects": len(added_projects),
        "addedTeamRecords": added_team, "addedStaffRecords": added_staff, "teamRecordsWithPlan168": sum(not item.get("archived") for item in team_records),
        "defaultRole": DEFAULT_ROLE
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
