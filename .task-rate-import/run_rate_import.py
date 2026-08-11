import copy
import json
import re
import sys
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

import openpyxl


def normalize(value):
    return re.sub(r"\s+", " ", str(value or "").strip()).lower()


def number(value):
    if value is None or str(value).strip() == "":
        return 0.0
    return float(value)


def request_json(api_url, method, path, body=None):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    request = Request(api_url + path, data=data, method=method)
    request.add_header("Accept", "application/json")
    if data is not None:
        request.add_header("Content-Type", "application/json; charset=utf-8")
    try:
        with urlopen(request, timeout=30) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        payload = error.read().decode("utf-8", errors="replace")
        try:
            return error.code, json.loads(payload)
        except json.JSONDecodeError:
            return error.code, {"error": payload}


def source_records(source_path):
    workbook = openpyxl.load_workbook(source_path, read_only=True, data_only=True)
    sheet = workbook["Ставки 26"]
    records = {}
    conflicts = []
    for row_number, row in enumerate(sheet.iter_rows(min_row=5, max_row=129, values_only=True), start=5):
        name = str(row[1] or "").strip()
        if not name:
            continue
        record = {
            "name": name,
            "row": row_number,
            "costPlan": {
                "2026": {
                    str(month): {
                        "rate": number(row[1 + month]),
                        "attraction": number(row[14 + month])
                    }
                    for month in range(1, 13)
                }
            }
        }
        key = normalize(name)
        if key in records:
            if records[key]["costPlan"] != record["costPlan"]:
                conflicts.append({"name": name, "rows": [records[key]["row"], row_number]})
            continue
        records[key] = record
    if conflicts:
        raise RuntimeError("В листе «Ставки 26» есть дубли с разными значениями: " + json.dumps(conflicts, ensure_ascii=False))
    return records


def resource_index(records):
    result = {}
    for record in records:
        for value in [record.get("name", "")] + record.get("sourceValues", []):
            key = normalize(value)
            if key:
                result.setdefault(key, []).append(record)
    return result


source_path = sys.argv[1]
api_url = sys.argv[2].rstrip("/")
source = source_records(source_path)

status, references = request_json(api_url, "GET", "/api/references")
if status != 200:
    raise RuntimeError(references.get("error", "Не удалось прочитать НСИ."))
directories = references["directories"]

staff_types = [record for record in directories["providers"]["records"] if normalize(record.get("name")) == "штат" and not record.get("archived")]
if not staff_types:
    raise RuntimeError("В НСИ отсутствует активный тип поставщика «Штат».")

vendors = [record for record in directories["vendors"]["records"] if normalize(record.get("name")) == "лт"]
vendor_action = "existing"
if vendors:
    vendor = vendors[0]
    status, payload = request_json(api_url, "PUT", "/api/references/vendors/" + quote(vendor["id"], safe=""), {
        "name": vendor["name"],
        "providerType": "Штат",
        "archived": False
    })
    if status != 200:
        raise RuntimeError(payload.get("error", "Не удалось обновить поставщика «ЛТ»."))
    vendor_action = "updated"
else:
    status, payload = request_json(api_url, "POST", "/api/references/vendors", {"name": "ЛТ", "providerType": "Штат"})
    if status not in (200, 201):
        raise RuntimeError(payload.get("error", "Не удалось создать поставщика «ЛТ»."))
    vendor_action = "created"

status, references = request_json(api_url, "GET", "/api/references")
if status != 200:
    raise RuntimeError(references.get("error", "Не удалось обновить НСИ после создания поставщика."))
resources = references["directories"]["resources"]["records"]
index = resource_index(resources)

created = []
updated = []
errors = []
for key, source_record in source.items():
    candidates = {record["id"]: record for record in index.get(key, [])}
    if len(candidates) > 1:
        errors.append({"name": source_record["name"], "error": "Несколько карточек ресурса с совпадающим наименованием."})
        continue
    if candidates:
        record = next(iter(candidates.values()))
        cost_plan = copy.deepcopy(record.get("costPlan") or {})
        cost_plan["2026"] = source_record["costPlan"]["2026"]
        body = {"name": record["name"], "vendor": "ЛТ", "costPlan": cost_plan, "archived": False}
        status, payload = request_json(api_url, "PUT", "/api/references/resources/" + quote(record["id"], safe=""), body)
        if status != 200:
            errors.append({"name": source_record["name"], "error": payload.get("error", "Не удалось обновить карточку."), "fields": payload.get("fields", {})})
        else:
            updated.append(source_record["name"])
    else:
        body = {"name": source_record["name"], "vendor": "ЛТ", "costPlan": source_record["costPlan"]}
        status, payload = request_json(api_url, "POST", "/api/references/resources", body)
        if status not in (200, 201):
            errors.append({"name": source_record["name"], "error": payload.get("error", "Не удалось создать карточку."), "fields": payload.get("fields", {})})
        else:
            created.append(source_record["name"])

print(json.dumps({
    "sourceResources": len(source),
    "vendorAction": vendor_action,
    "updated": len(updated),
    "created": len(created),
    "errors": errors
}, ensure_ascii=False))
