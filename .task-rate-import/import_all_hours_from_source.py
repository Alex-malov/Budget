import difflib
import hashlib
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import openpyxl


YEARS = ("2024", "2025", "2026")
MONTHS = tuple(str(month) for month in range(1, 13))


def normalize(value):
    return re.sub(r"\s+", " ", str(value or "").strip()).casefold()


def name_tokens(value):
    return re.sub(r"[^а-яa-z0-9 ]", " ", normalize(value).replace("ё", "е")).split()


def name_key(value):
    return " ".join(name_tokens(value)[:2])


def number(value):
    if value is None or str(value).strip() == "":
        return 0.0
    return float(value)


def stable_id(prefix, *parts):
    return prefix + "-" + hashlib.sha1("|".join(normalize(part) for part in parts).encode("utf-8")).hexdigest()[:16]


def months(value=0):
    return {str(month): value for month in range(1, 13)}


def zero_plan():
    return {year: months(0) for year in YEARS}


def zero_annual():
    return {year: 0 for year in YEARS}


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
    result = {}
    for record in records:
        if record.get("deleted"):
            continue
        for value in [record.get("name")] + list(record.get("sourceValues") or []):
            if normalize(value):
                result[normalize(value)] = record
    return result


def employee_facts(source_path):
    sheet = openpyxl.load_workbook(source_path, read_only=True, data_only=True).active
    employee = ""
    facts = defaultdict(lambda: {"annual": 0.0, "monthly": {"2025": months(0), "2026": months(0)}})
    for row in sheet.iter_rows(min_row=6, values_only=True):
        label = str(row[0] or "").strip()
        if not label:
            continue
        if not re.match(r"^20\d{2}-", label):
            employee = label
            continue
        if not employee:
            continue
        annual_2024 = number(row[1])
        values_2025 = [number(value) for value in row[2:14]]
        values_2026 = [number(value) for value in row[14:21]]
        if not annual_2024 and not any(values_2025) and not any(values_2026):
            continue
        item = facts[(employee, label)]
        item["annual"] += annual_2024
        for index, value in enumerate(values_2025, start=1):
            item["monthly"]["2025"][str(index)] += value
        for index, value in enumerate(values_2026, start=1):
            item["monthly"]["2026"][str(index)] += value
    return facts


def similarity(left, right):
    return difflib.SequenceMatcher(None, " ".join(name_tokens(left)), " ".join(name_tokens(right))).ratio()


def main():
    source_path = Path(sys.argv[1])
    root = Path(sys.argv[2])
    data = root / "data"
    current_refs_file = load_json(data / "reference-overrides.json")
    previous_refs_file = load_json(data / "backups" / "hours-import-20260803" / "reference-overrides.json")
    team_file = load_json(data / "team-overrides.json")
    staff_file = load_json(data / "staff-overrides.json")
    subcontract_path = data / "subcontract-overrides.json"
    if subcontract_path.exists():
        subcontract_file = load_json(subcontract_path)
    else:
        snapshot = load_json(data / "model-snapshot.json")
        subcontract_file = {"records": [
            {
                "id": "source-" + str(record.get("id")) + "-" + str(month.get("period")), "source": "model",
                "resource": "", "project": record.get("project") or "Не указан", "vendor": record.get("vendor") or "Не указан",
                "article": record.get("subject") or record.get("resource") or "Без статьи", "period": month.get("period"),
                "amount": number(month.get("amount")), "rate": number(record.get("rate")), "estimatedHours": None,
                "actualHours": 0, "annualActualHours": zero_annual(), "archived": False
            }
            for record in snapshot.get("subcontracts", []) for month in record.get("monthly", [])
        ]}
    directories = current_refs_file["directories"]
    current_resources = directories["resources"]
    current_projects = directories["projects"]
    current_resource_index = reference_index(current_resources)
    current_project_index = reference_index(current_projects)
    previous_resource_index = reference_index(previous_refs_file["directories"]["resources"])
    current_by_id = {record.get("id"): record for record in current_resources}
    vendor_types = {normalize(record.get("name")): record.get("providerType") for record in directories["vendors"] if not record.get("deleted")}
    source = employee_facts(source_path)

    def resolve_project(value):
        record = current_project_index.get(normalize(value))
        if record:
            return record["name"]
        record = {
            "id": stable_id("auto-project-hours", value), "name": value, "value": "", "parent": "", "providerType": "", "vendor": "",
            "sourceKey": normalize(value), "sourceValues": [value], "archived": False, "deleted": False
        }
        current_projects.append(record)
        current_project_index[normalize(value)] = record
        return record["name"]

    def resolve_employee(value):
        prior = previous_resource_index.get(normalize(value))
        if prior and prior.get("id") in current_by_id:
            target = current_by_id[prior["id"]]
            target["vendor"] = prior.get("vendor", target.get("vendor", ""))
            return target, {"source": value, "target": target["name"], "kind": "exact", "score": 1.0}
        source_key = name_key(value)
        candidates = [record for record in previous_refs_file["directories"]["resources"] if not record.get("deleted") and name_key(record.get("name")) == source_key and source_key]
        if candidates:
            selected = max(candidates, key=lambda record: similarity(value, record.get("name")))
            target = current_by_id.get(selected.get("id"))
            if target:
                target["vendor"] = selected.get("vendor", target.get("vendor", ""))
                return target, {"source": value, "target": target["name"], "kind": "fuzzy", "score": round(similarity(value, target["name"]), 4)}
        existing = current_resource_index.get(normalize(value))
        if existing:
            return existing, {"source": value, "target": existing["name"], "kind": "source-resource", "score": None}
        resource = {
            "id": stable_id("auto-resource-hours", value), "name": value, "value": "", "parent": "", "providerType": "", "vendor": "ЛТ",
            "costPlan": {year: {month: {"rate": 0, "attraction": 0} for month in MONTHS} for year in YEARS},
            "sourceKey": normalize(value), "sourceValues": [value], "archived": False, "deleted": False
        }
        current_resources.append(resource)
        current_resource_index[normalize(value)] = resource
        current_by_id[resource["id"]] = resource
        return resource, {"source": value, "target": resource["name"], "kind": "created-source-resource", "score": None}

    resolved = defaultdict(lambda: {"annual": 0.0, "monthly": {"2025": months(0), "2026": months(0)}, "match": None, "resource": None, "project": ""})
    matches = []
    source_resolutions = []
    for (employee, project), values in source.items():
        resource, match = resolve_employee(employee)
        target_project = resolve_project(project)
        key = (resource["name"], target_project)
        target = resolved[key]
        target["resource"] = resource
        target["project"] = target_project
        target["match"] = match
        target["annual"] += values["annual"]
        for year in ("2025", "2026"):
            for month in MONTHS:
                target["monthly"][year][month] += values["monthly"][year][month]
        matches.append(match)
        source_resolutions.append({"sourceEmployee": employee, "sourceProject": project, "targetEmployee": resource["name"], "targetProject": target_project, "kind": match["kind"], "score": match["score"], "hours": values})

    team_records = [record for record in team_file["records"] if record.get("origin") != "nsi-sync"]
    staff_records = [record for record in staff_file["records"] if record.get("origin") != "nsi-sync"]
    subcontract_records = [record for record in subcontract_file["records"] if not str(record.get("id", "")).startswith("auto-hours-subcontract-")]

    def canonical_resource(value):
        return (current_resource_index.get(normalize(value)) or {"name": value}).get("name")

    def canonical_project(value):
        return (current_project_index.get(normalize(value)) or {"name": value}).get("name")

    for record in team_records:
        record["hoursPlan"] = zero_plan()
        record["hoursPlanAnnual"] = zero_annual()
    for record in staff_records:
        record["hoursActual"] = zero_plan()
        record["hoursActualAnnual"] = zero_annual()

    def provider_type(resource):
        return vendor_types.get(normalize(resource.get("vendor"))) or "Штат"

    def role_for(employee):
        for record in team_records + staff_records:
            if not record.get("archived") and normalize(canonical_resource(record.get("employee"))) == normalize(employee) and record.get("role"):
                return record["role"]
        return "Не определена"

    def find_team(employee, project, source_type):
        for record in team_records:
            if record.get("archived"):
                continue
            if record.get("source") != source_type:
                continue
            if normalize(canonical_resource(record.get("employee"))) == normalize(employee) and normalize(canonical_project(record.get("project"))) == normalize(project):
                return record
        return None

    def find_staff(employee, project, role):
        for record in staff_records:
            if record.get("archived"):
                continue
            if normalize(canonical_resource(record.get("employee"))) == normalize(employee) and normalize(canonical_project(record.get("project"))) == normalize(project) and normalize(record.get("role")) == normalize(role):
                return record
        return None

    def apply_plan(record, values):
        record["hoursPlanAnnual"]["2024"] = values["annual"]
        for year in ("2025", "2026"):
            for month in MONTHS:
                record["hoursPlan"][year][month] = values["monthly"][year][month]
        if any(values["monthly"]["2026"][month] > 0 for month in ("5", "6", "7")):
            for month in ("8", "9", "10", "11", "12"):
                record["hoursPlan"]["2026"][month] = 168

    def apply_actual(record, values):
        record["hoursActualAnnual"]["2024"] = values["annual"]
        for year in ("2025", "2026"):
            for month in MONTHS:
                record["hoursActual"][year][month] = values["monthly"][year][month]

    contractor_pairs = []
    staff_pairs = []
    for (employee, project), values in sorted(resolved.items()):
        resource = values["resource"]
        source_type = provider_type(resource)
        role = role_for(employee)
        team_record = find_team(employee, project, source_type)
        if not team_record:
            team_record = {
                "id": stable_id("auto-team-source-hours", source_type, employee, project), "employee": employee, "vendor": resource.get("vendor", ""), "project": project,
                "role": role, "source": source_type, "origin": "nsi-sync", "archived": False, "hoursPlan": zero_plan(), "hoursPlanAnnual": zero_annual(),
                "costPlan": resource.get("costPlan", {}), "rate": 0, "attraction": 0, "cost": 0
            }
            team_records.append(team_record)
        # В НСИ проект хранится под наименованием договора из исходного файла.
        # Старые записи модели могли содержать его прежний синоним; после
        # сопоставления переводим запись на актуальное значение справочника.
        team_record["project"] = project
        apply_plan(team_record, values)
        if source_type == "Подряд":
            contractor_pairs.append((employee, project))
            for month in MONTHS:
                if month == "1":
                    annual = {"2024": values["annual"]}
                    record = {
                        "id": stable_id("auto-hours-subcontract", employee, project, "2024", month), "source": "nsi-sync", "resource": employee,
                        "project": project, "vendor": resource.get("vendor", ""), "article": "Часы подряд", "period": "2024-" + month,
                        "amount": 0, "rate": 0, "estimatedHours": None, "actualHours": 0, "annualActualHours": annual, "archived": False
                    }
                    subcontract_records.append(record)
            for year, active_months in (("2025", MONTHS), ("2026", tuple(str(month) for month in range(1, 8)))):
                for month in active_months:
                    subcontract_records.append({
                        "id": stable_id("auto-hours-subcontract", employee, project, year, month), "source": "nsi-sync", "resource": employee,
                        "project": project, "vendor": resource.get("vendor", ""), "article": "Часы подряд", "period": year + "-" + month.zfill(2),
                        "amount": 0, "rate": 0, "estimatedHours": None, "actualHours": values["monthly"][year][month], "annualActualHours": zero_annual(), "archived": False
                    })
        else:
            staff_pairs.append((employee, project))
            staff_record = find_staff(employee, project, team_record["role"])
            if not staff_record:
                staff_record = {
                    "id": stable_id("auto-staff-source-hours", employee, project), "employee": employee, "project": project, "role": team_record["role"],
                    "group": "Автоматически из НСИ", "cost": 0, "origin": "nsi-sync", "archived": False,
                    "hoursPlan": zero_plan(), "hoursPlanAnnual": zero_annual(), "hoursActual": zero_plan(), "hoursActualAnnual": zero_annual()
                }
                staff_records.append(staff_record)
            staff_record["project"] = project
            apply_actual(staff_record, values)

    used_resources = {normalize(record.get("employee")) for record in team_records if not record.get("archived")}
    for resource in current_resources:
        if str(resource.get("id", "")).startswith("auto-resource-hours-") and normalize(resource.get("name")) not in used_resources:
            resource["archived"] = True

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    current_refs_file["updatedAt"] = now
    team_file["records"] = team_records
    team_file["updatedAt"] = now
    staff_file["records"] = staff_records
    staff_file["updatedAt"] = now
    subcontract_file["records"] = subcontract_records
    subcontract_file["updatedAt"] = now
    save_json(data / "reference-overrides.json", current_refs_file)
    save_json(data / "team-overrides.json", team_file)
    save_json(data / "staff-overrides.json", staff_file)
    save_json(subcontract_path, subcontract_file)

    report_dir = data / "import-reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    report = {
        "source": source_path.name, "importedAt": now, "sourcePairs": len(source), "resolvedPairs": len(resolved),
        "sourceHours": {"2024": sum(values["annual"] for values in source.values()), "2025": sum(sum(values["monthly"]["2025"].values()) for values in source.values()), "2026JanJul": sum(sum(values["monthly"]["2026"].values()) for values in source.values())},
        "staffPairs": len(staff_pairs), "contractorPairs": len(contractor_pairs),
        "fuzzyMatches": [item for item in matches if item["kind"] == "fuzzy"],
        "sourceNamedResources": [item for item in matches if item["kind"] in ("source-resource", "created-source-resource")],
        "resolutions": source_resolutions
    }
    report_path = report_dir / "hours-import-20260803.json"
    save_json(report_path, report)
    print(json.dumps({
        "sourcePairs": report["sourcePairs"], "resolvedPairs": report["resolvedPairs"], "staffPairs": report["staffPairs"], "contractorPairs": report["contractorPairs"],
        "fuzzyMatches": len(report["fuzzyMatches"]), "sourceNamedResources": len(report["sourceNamedResources"]), "report": str(report_path)
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
