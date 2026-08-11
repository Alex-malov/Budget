import json
import re
import sys
from urllib.request import urlopen

import openpyxl


def normalize(value):
    return re.sub(r"\s+", " ", str(value or "").strip()).lower()


def number(value):
    if value is None or str(value).strip() == "":
        return 0.0
    return float(value)


def source_records(source_path):
    workbook = openpyxl.load_workbook(source_path, read_only=True, data_only=True)
    sheet = workbook["Ставки 26"]
    records = {}
    for row_number, row in enumerate(sheet.iter_rows(min_row=5, max_row=129, values_only=True), start=5):
        name = str(row[1] or "").strip()
        if not name:
            continue
        key = normalize(name)
        record = {
            "name": name,
            "row": row_number,
            "rate": [number(value) for value in row[2:14]],
            "attraction": [number(value) for value in row[15:27]]
        }
        if key not in records:
            records[key] = record
    return records


source_path = sys.argv[1]
api_url = sys.argv[2].rstrip("/")
source = source_records(source_path)
with urlopen(api_url + "/api/references") as response:
    directories = json.load(response)["directories"]

resources_by_key = {}
for resource in directories["resources"]["records"]:
    for value in [resource.get("name", "")] + resource.get("sourceValues", []):
        key = normalize(value)
        if key:
            resources_by_key.setdefault(key, []).append(resource)

missing = []
ambiguous = []
card_mismatches = []
cost_mismatches = []
checked_values = 0
matched_values = 0
for key, expected in source.items():
    candidates = {record["id"]: record for record in resources_by_key.get(key, [])}
    if not candidates:
        missing.append(expected["name"])
        continue
    if len(candidates) > 1:
        ambiguous.append({"name": expected["name"], "ids": sorted(candidates)})
        continue
    resource = next(iter(candidates.values()))
    if resource.get("vendor") != "ЛТ" or resource.get("providerType") != "Штат" or resource.get("archived"):
        card_mismatches.append({
            "name": expected["name"],
            "vendor": resource.get("vendor"),
            "providerType": resource.get("providerType"),
            "archived": resource.get("archived")
        })
    cost_plan = resource.get("costPlan") or {}
    months = cost_plan.get("2026") or {}
    for month in range(1, 13):
        actual = months.get(str(month)) or {}
        for field, expected_values in (("rate", expected["rate"]), ("attraction", expected["attraction"])):
            checked_values += 1
            actual_value = number(actual.get(field))
            expected_value = expected_values[month - 1]
            if actual_value == expected_value:
                matched_values += 1
            else:
                cost_mismatches.append({
                    "name": expected["name"],
                    "month": month,
                    "field": field,
                    "expected": expected_value,
                    "actual": actual_value
                })

vendors = [record for record in directories["vendors"]["records"] if normalize(record.get("name")) == "лт"]
vendor_check = {
    "exists": len(vendors) == 1,
    "active": len(vendors) == 1 and not vendors[0].get("archived"),
    "providerType": vendors[0].get("providerType") if len(vendors) == 1 else None
}

passed = not (missing or ambiguous or card_mismatches or cost_mismatches) and vendor_check == {"exists": True, "active": True, "providerType": "Штат"}
print(json.dumps({
    "status": "PASS" if passed else "FAIL",
    "sourceResources": len(source),
    "matchedResourceCards": len(source) - len(missing) - len(ambiguous),
    "checkedMonthlyValues": checked_values,
    "matchedMonthlyValues": matched_values,
    "vendorLt": vendor_check,
    "missing": missing,
    "ambiguous": ambiguous,
    "cardMismatches": card_mismatches,
    "costMismatches": cost_mismatches
}, ensure_ascii=False))
