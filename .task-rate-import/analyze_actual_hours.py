import json
import re
import sys
from collections import defaultdict
from urllib.request import urlopen

import openpyxl


def normalize(value):
    return re.sub(r"\s+", " ", str(value or "").strip()).lower()


def number(value):
    if value is None or str(value).strip() == "":
        return 0.0
    return float(value)


source_path = sys.argv[1]
api_url = sys.argv[2].rstrip("/")
workbook = openpyxl.load_workbook(source_path, read_only=True, data_only=True)
sheet = workbook.active

current_employee = ""
facts = defaultdict(lambda: [0.0] * 7)
for row in sheet.iter_rows(min_row=6, values_only=True):
    label = str(row[0] or "").strip()
    if not label:
        continue
    if re.match(r"^20\d{2}-", label):
        if not current_employee:
            continue
        values = [number(value) for value in row[14:21]]
        if any(values):
            key = (current_employee, label)
            facts[key] = [facts[key][month] + values[month] for month in range(7)]
    else:
        current_employee = label

with urlopen(api_url + "/api/staff") as response:
    staff = json.load(response)["records"]
with urlopen(api_url + "/api/team") as response:
    team = json.load(response)["records"]
with urlopen(api_url + "/api/references") as response:
    references = json.load(response)["directories"]

staff_by_key = defaultdict(list)
for record in staff:
    staff_by_key[(normalize(record.get("employee")), normalize(record.get("project")))].append(record)
team_by_key = defaultdict(list)
for record in team:
    team_by_key[(normalize(record.get("employee")), normalize(record.get("project")))].append(record)
project_by_key = defaultdict(list)
for record in references["projects"]["records"]:
    project_by_key[normalize(record.get("name"))].append(record)
employee_names = {normalize(record.get("employee")): record.get("employee") for record in team}

matched = []
missing_staff = []
missing_team = []
missing_projects = []
multi_staff = []
for (employee, project), values in sorted(facts.items(), key=lambda item: (item[0][0], item[0][1])):
    key = (normalize(employee), normalize(project))
    staff_candidates = staff_by_key[key]
    team_candidates = team_by_key[key]
    item = {"employee": employee, "project": project, "hours": values, "total": sum(values)}
    if staff_candidates:
        matched.append(item)
        if len(staff_candidates) > 1:
            multi_staff.append({"employee": employee, "project": project, "ids": [record["id"] for record in staff_candidates]})
    else:
        missing_staff.append(item)
    if not team_candidates:
        missing_team.append(item)
    if not project_by_key[normalize(project)]:
        missing_projects.append(project)

current_actual_2026 = 0.0
for record in staff:
    current_actual_2026 += sum(number((record.get("hoursActual") or {}).get("2026", {}).get(str(month))) for month in range(1, 13))

print(json.dumps({
    "sourceFactPairs": len(facts),
    "sourceEmployees": len({employee for employee, _ in facts}),
    "sourceProjects": sorted({project for _, project in facts}),
    "sourceHours2026": sum(sum(values) for values in facts.values()),
    "matchedStaffPairs": len(matched),
    "missingStaff": missing_staff,
    "missingTeam": missing_team,
    "missingProjects": sorted(set(missing_projects)),
    "multiStaff": multi_staff,
    "sourceEmployeesAbsentFromTeam": sorted({employee for employee, _ in facts if normalize(employee) not in employee_names}),
    "currentActualHours2026": current_actual_2026
}, ensure_ascii=False))
