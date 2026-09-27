#!/usr/bin/env python3
"""Generate the Test Flight synthetic dataset.

Produces two files from one source of truth:
  data/dataset.json   - read by the serverless API (api/_lib/data.js)
  assets/data.js      - embedded in the static console (window.TF_DATA)

Company: Aeris Health (fictional CPAP maker). Products: Aeris Air CPAP,
Aeris Air Mini CPAP, and the Aeris Air companion app. All records are
synthetic. Khizar Kashif is Product Manager of the Companion App pod.

Run:  python3 scripts/gen_dataset.py
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent

QA = "\u2014"  # em dash

# Canonical, plausible deep links back to where each piece of evidence lives.
# Points at the fictional Aeris Health tenant so a demo click always resolves to
# the right kind of source page. Live connectors return real URLs instead.
APPSTORE_URL = "https://apps.apple.com/us/app/aeris-air/id6472108933?see-all=reviews"


def evidence_url(src):
    s = (src or "").lower()
    if s.startswith("app store"):
        return APPSTORE_URL
    if "zendesk #" in s:
        m = re.search(r"(\d+)", src)
        return f"https://aerishealth.zendesk.com/agent/tickets/{m.group(1)}" if m else "https://aerishealth.zendesk.com/agent/tickets"
    if "email msg-" in s:
        m = re.search(r"msg-(\w+)", src)
        return f"https://mail.google.com/mail/u/0/#all/{m.group(1)}" if m else "https://mail.google.com/mail/u/0/#all"
    if s.startswith("slack"):
        return "https://aerishealth.slack.com/archives/C06AERIS01"
    if s.startswith("zoom"):
        return "https://us06web.zoom.us/rec/share/aeris-air-clinic-onboarding"
    if s.startswith("salesforce"):
        m = re.search(r"(\d+)", src)
        return f"https://aerishealth.lightning.force.com/lightning/r/Case/{m.group(1)}/view" if m else "https://aerishealth.lightning.force.com"
    if s.startswith("intercom"):
        return "https://app.intercom.com/a/inbox/aeris-air/"
    return None

SOURCES = [
    {"id": "salesforce", "name": "Salesforce", "value": 452, "complaints": 194, "product": 198, "excluded": 60},
    {"id": "zendesk", "name": "Zendesk", "value": 431, "complaints": 185, "product": 189, "excluded": 57},
    {"id": "gmail", "name": "Email + Gmail", "value": 322, "complaints": 134, "product": 141, "excluded": 47},
    {"id": "slack", "name": "Slack", "value": 268, "complaints": 72, "product": 152, "excluded": 44},
    {"id": "zoom", "name": "Zoom + Granola", "value": 197, "complaints": 48, "product": 118, "excluded": 31},
    {"id": "appstore", "name": "App store reviews", "value": 149, "complaints": 51, "product": 82, "excluded": 16},
    {"id": "intercom", "name": "Intercom", "value": 54, "complaints": 20, "product": 24, "excluded": 10},
]

SOURCE_FEED = {
    "salesforce": [
        {"t": "Customer asks whether Aeris Air humidifier lot 409-TX is in the field-safety notice.", "cls": "label-danger", "label": "Potential MDR", "when": "6h ago"},
        {"t": "Account requests a batch traceability export for their clinic fleet.", "cls": "label-accent", "label": "Product feedback", "when": "9h ago"},
        {"t": "Case reports a delivery delay on replacement mask cushions.", "cls": "label-warning", "label": "Complaint", "when": "1d ago"},
    ],
    "zendesk": [
        {"t": "App stalls at 99% on nightly sync with two therapy profiles active.", "cls": "label-warning", "label": "Complaint", "when": "44 min ago"},
        {"t": "Three false low-pressure alarms this week; each woke the household.", "cls": "label-warning", "label": "Complaint", "when": "2d ago"},
        {"t": "Can the app email a clean therapy PDF to my sleep clinic instead of screenshots?", "cls": "label-accent", "label": "Product feedback", "when": "6d ago"},
    ],
    "gmail": [
        {"t": "False low-pressure alerts most nights [excerpt].", "cls": "label-warning", "label": "Complaint", "when": "2h ago"},
        {"t": "Device reported an apnea event overnight and the alarm never sounded.", "cls": "label-danger", "label": "Potential MDR", "when": "1d ago"},
        {"t": "Request: a weekly therapy summary email instead of per-event pushes.", "cls": "label-accent", "label": "Product feedback", "when": "8d ago"},
    ],
    "slack": [
        {"t": "Therapy chart contrast in dark mode is nearly invisible against the grid.", "cls": "label-accent", "label": "Product feedback", "when": "5h ago"},
        {"t": "Nightly sync never completes; clinicians are exporting reports by hand.", "cls": "label-warning", "label": "Complaint", "when": "1d ago"},
        {"t": "Beta thread: BLE pairing is the worst part of onboarding the new sensor tube.", "cls": "label-accent", "label": "Product feedback", "when": "9d ago"},
    ],
    "zoom": [
        {"t": "[transcript] The export step is the most manual part of my morning clinic prep.", "cls": "label-accent", "label": "Product feedback", "when": "6d ago"},
        {"t": "[transcript] Clinician asks for a shareable pressure report the whole sleep lab can open.", "cls": "label-accent", "label": "Product feedback", "when": "12d ago"},
        {"t": "[transcript] Onboarding call flagged Bluetooth pairing friction on the Air Mini.", "cls": "label-accent", "label": "Product feedback", "when": "18d ago"},
    ],
    "appstore": [
        {"t": "App sync hangs repeatedly at 99% after the 4.2.1 update.", "cls": "label-warning", "label": "Complaint", "when": "18 min ago"},
        {"t": "Mask cushion seam split after two weeks; leak alarm kept firing.", "cls": "label-warning", "label": "Complaint", "when": "3h ago"},
        {"t": "Battery used to last four nights, now barely two.", "cls": "label-accent", "label": "Product feedback", "when": "7d ago"},
    ],
    "intercom": [
        {"t": "In-app message: tonight's session logged as 0.0 hours; my nurse flagged it.", "cls": "label-warning", "label": "Complaint", "when": "3h ago"},
        {"t": "Home-screen widget request for the nightly AHI score.", "cls": "label-accent", "label": "Product feedback", "when": "4d ago"},
    ],
}

SPLIT = [
    {"name": "Product feedback", "value": 904, "color": "var(--accent)"},
    {"name": "Complaint candidates", "value": 704, "color": "var(--danger)"},
]

TREND = {
    "labels": ["W3", "W4", "W5", "W6", "W7", "W8", "W9", "W10", "W11", "W12", "W13", "W14"],
    "quality": [42, 47, 45, 52, 49, 57, 55, 62, 60, 66, 69, 73],
    "product": [58, 62, 67, 65, 71, 74, 72, 79, 81, 78, 85, 88],
}

IDEAS = [
    {
        "id": "idea-sync-stall",
        "title": "Nightly therapy sync stalls at 99% on iOS (app 4.2.1)",
        "pod": "Companion App",
        "priority": "Critical",
        "reports": 68,
        "ageDays": 2,
        "sent": "negative",
        "sources": [["appstore", "App store reviews"], ["zendesk", "Zendesk"], ["slack", "Slack"], ["gmail", "Email + Gmail"]],
        "quote": "\u201cApp sync hangs repeatedly at 99%. Patient unable to export nightly pressure reports for clinic follow-up.\u201d",
        "jira": "APP-2214",
        "jiraTitle": "Fix sync deadlock on nightly upload (iOS)",
        "jiraStatus": "In Review",
        "jiraClass": "label-accent",
        "assignee": "R. Okafor",
        "sprint": "W14 \u00b7 Sprint 31",
        "points": 8,
        "updated": "18 min ago",
        "stage": "In build",
        "roadmapIdx": 2,
        "roadmapNote": "Scoped for the W14 freeze. Two related reports open against the same socket path.",
        "demand": 48,
        "effort": 62,
        "owner": {"name": "R. Okafor", "verified": True, "role": "Companion App lead"},
        "crm": "2 enterprise clinic accounts in cluster \u00b7 combined ARR $340k",
        "crmVerified": False,
        "why": "Nine independent reports describe an identical hang at 99% after the 4.2.1 update, all resolving only when the app is force-quit. The version clustering is what promoted this from isolated tickets to one idea.",
        "evidence": [
            {"text": "\u201cSync hangs at 99% every time on my iPhone after the update.\u201d", "src": "App store \u00b7 iOS", "when": "Mar 21", "prov": "synthetic"},
            {"text": "\u201cTwo therapy profiles active and the socket just hangs; support had no fix.\u201d", "src": "Zendesk #48219", "when": "Mar 22", "prov": "synthetic"},
            {"text": "\u201cNightly upload never completes, I export manually for the clinic.\u201d", "src": "Slack #voice-of-customer", "when": "Mar 23", "prov": "synthetic"},
        ],
    },
    {
        "id": "idea-false-alarm",
        "title": "False low-pressure alerts during sleep",
        "pod": "Algorithms & Safety",
        "priority": "Critical",
        "reports": 41,
        "ageDays": 3,
        "sent": "negative",
        "sources": [["gmail", "Email + Gmail"], ["appstore", "App store reviews"], ["zendesk", "Zendesk"]],
        "quote": "\u201cfalse low-pressure alerts most nights \u2014 I wake up panicked and can\u2019t tell if it is real.\u201d",
        "jira": "SAFE-1108",
        "jiraTitle": "Reduce false low-pressure alert rate in sleep window",
        "jiraStatus": "In Progress",
        "jiraClass": "label-accent",
        "assignee": "Dr. L. Park",
        "sprint": "W14 \u00b7 Sprint 31",
        "points": 13,
        "updated": "1h ago",
        "stage": "In build",
        "roadmapIdx": 2,
        "roadmapNote": "Algorithm threshold work with an interim clinician-reviewed suppression rule.",
        "demand": 41,
        "effort": 84,
        "owner": {"name": "Dr. L. Park", "verified": True, "role": "Clinical algorithms"},
        "crm": "Cross-account \u00b7 no single account concentration",
        "crmVerified": False,
        "why": "Reports span 11 days and three sources but converge on one threshold band (00:00\u201305:00). Clinical risk without a known harm event, so it is flagged to quality as well as product.",
        "evidence": [
            {"text": "\u201cfalse low-pressure alerts most nights [excerpt]\u201d", "src": "Email msg-5043", "when": "Mar 23", "prov": "synthetic"},
            {"text": "\u201cAlarm fired at 2am and there was nothing wrong on the repeat reading.\u201d", "src": "App store \u00b7 iOS", "when": "Mar 19", "prov": "synthetic"},
            {"text": "\u201cThree false alarms this week, each woke the whole household.\u201d", "src": "Zendesk #48107", "when": "Mar 20", "prov": "synthetic"},
        ],
    },
    {
        "id": "idea-mask-fit",
        "title": "Mask leak alarms after cushion or headgear changes",
        "pod": "Hardware & Masks",
        "priority": "High",
        "reports": 33,
        "ageDays": 5,
        "sent": "mixed",
        "sources": [["appstore", "App store reviews"], ["zendesk", "Zendesk"], ["gmail", "Email + Gmail"]],
        "quote": "\u201cNew cushion and the leak alarm fires all night even though the fit feels fine.\u201d",
        "jira": "HW-3391",
        "jiraTitle": "Recalibrate leak detection after mask swap",
        "jiraStatus": "In Progress",
        "jiraClass": "label-accent",
        "assignee": "S. Novak",
        "sprint": "W14 \u00b7 Sprint 31",
        "points": 8,
        "updated": "5h ago",
        "stage": "In build",
        "roadmapIdx": 2,
        "roadmapNote": "Leak baseline is stored per mask model; needs a re-baseline on swap.",
        "demand": 33,
        "effort": 58,
        "owner": {"name": "S. Novak", "verified": True, "role": "Hardware & masks"},
        "crm": "Spread across consumer base \u00b7 no account concentration",
        "crmVerified": False,
        "why": "Telemetry correlates the complaints with a leak baseline that is not reset when the mask model changes, so these reports are grouped rather than treated as separate device failures.",
        "evidence": [
            {"text": "\u201cLeak alarm fires every night since I switched to the nasal pillows.\u201d", "src": "App store \u00b7 iOS", "when": "Mar 18", "prov": "synthetic"},
            {"text": "\u201cFit is fine but the app says high leak from 2am.\u201d", "src": "Zendesk #47855", "when": "Mar 19", "prov": "synthetic"},
        ],
    },
    {
        "id": "idea-clinician-pdf",
        "title": "Export nightly therapy reports as a clinician PDF",
        "pod": "Clinical Workflows",
        "priority": "Medium",
        "reports": 27,
        "ageDays": 6,
        "sent": "mixed",
        "sources": [["zendesk", "Zendesk"], ["zoom", "Zoom + Granola"]],
        "quote": "\u201cI still print screenshots for the clinic. A single PDF would replace my whole morning.\u201d",
        "jira": "CLIN-770",
        "jiraTitle": "Clinician PDF export for therapy reports",
        "jiraStatus": "Planned",
        "jiraClass": "label-info",
        "assignee": "Unassigned",
        "sprint": "W16 \u00b7 Backlog",
        "points": 5,
        "updated": "2d ago",
        "stage": "Planned",
        "roadmapIdx": 3,
        "roadmapNote": "High-demand, low-effort. Best candidate to pull forward into W15 if capacity opens.",
        "demand": 27,
        "effort": 34,
        "owner": {"name": "M. Adeyemi (proposed)", "verified": False, "role": "Clinical workflows"},
        "crm": "3 sleep-clinic accounts requested this on calls",
        "crmVerified": False,
        "why": "Recurring request across support tickets and two recorded Zoom calls. Not a safety signal; a workflow gap. Low effort relative to demand.",
        "evidence": [
            {"text": "\u201cCan the app email a clean PDF to my clinic instead of screenshots?\u201d", "src": "Zendesk #47980", "when": "Mar 18", "prov": "synthetic"},
            {"text": "\u201c[transcript] the export step is the most manual part of my morning\u201d", "src": "Zoom call \u00b7 clinic onboarding", "when": "Mar 17", "prov": "paraphrased public"},
        ],
    },
    {
        "id": "idea-health-integration",
        "title": "Sync therapy data to Apple Health / HealthKit",
        "pod": "Platform & Data",
        "priority": "Medium",
        "reports": 24,
        "ageDays": 8,
        "sent": "neutral",
        "sources": [["appstore", "App store reviews"], ["intercom", "Intercom"], ["slack", "Slack"]],
        "quote": "\u201cI want my sleep and SpO2 from the CPAP to land in Apple Health with everything else.\u201d",
        "jira": "PLAT-2044",
        "jiraTitle": "HealthKit write-back for therapy and SpO2",
        "jiraStatus": "Planned",
        "jiraClass": "label-info",
        "assignee": "K. Nakamura",
        "sprint": "W16 \u00b7 Backlog",
        "points": 8,
        "updated": "3d ago",
        "stage": "Planned",
        "roadmapIdx": 3,
        "roadmapNote": "Needs a data-sharing consent flow before any HealthKit write.",
        "demand": 24,
        "effort": 52,
        "owner": {"name": "K. Nakamura", "verified": True, "role": "Platform & data"},
        "crm": "Consumer-driven \u00b7 no account concentration",
        "crmVerified": False,
        "why": "A cross-source integration request: users want Aeris Air data alongside their other health signals. Grouped because it is one integration, not many features.",
        "evidence": [
            {"text": "\u201cPlease write the nightly AHI into Apple Health.\u201d", "src": "App store \u00b7 iOS", "when": "Mar 14", "prov": "synthetic"},
            {"text": "\u201cCan I see the CPAP sessions in the Health app?\u201d", "src": "Intercom conversation", "when": "Mar 15", "prov": "synthetic"},
        ],
    },
    {
        "id": "idea-alarm-customization",
        "title": "Customize alarm volume and alert types per profile",
        "pod": "Algorithms & Safety",
        "priority": "Medium",
        "reports": 22,
        "ageDays": 9,
        "sent": "mixed",
        "sources": [["zendesk", "Zendesk"], ["slack", "Slack"], ["appstore", "App store reviews"]],
        "quote": "\u201cI need a gentle wake alarm for me and a loud one for my father\u2019s profile.\u201d",
        "jira": "SAFE-1142",
        "jiraTitle": "Per-profile alarm volume and alert-type settings",
        "jiraStatus": "In Review",
        "jiraClass": "label-accent",
        "assignee": "A. Okonkwo",
        "sprint": "W14 \u00b7 Sprint 31",
        "points": 5,
        "updated": "6h ago",
        "stage": "In build",
        "roadmapIdx": 2,
        "roadmapNote": "Pair with the alarm-precision work so customization cannot silence a safety alarm below the floor.",
        "demand": 22,
        "effort": 40,
        "owner": {"name": "A. Okonkwo", "verified": True, "role": "Algorithms & safety"},
        "crm": "Multi-user households \u00b7 no account concentration",
        "crmVerified": False,
        "why": "One feature request repeated across households. Any change is constrained by the alarm floor, so it is co-owned with Algorithms & Safety.",
        "evidence": [
            {"text": "\u201cTwo profiles, two people, one alarm volume \u2014 please fix.\u201d", "src": "Zendesk #47701", "when": "Mar 13", "prov": "synthetic"},
            {"text": "\u201cAlarm customization is the top request in the beta thread.\u201d", "src": "Slack #beta-feedback", "when": "Mar 14", "prov": "synthetic"},
        ],
    },
    {
        "id": "idea-humidifier",
        "title": "Humidifier level resets after firmware update",
        "pod": "Hardware & Masks",
        "priority": "High",
        "reports": 21,
        "ageDays": 1,
        "sent": "negative",
        "sources": [["appstore", "App store reviews"], ["gmail", "Email + Gmail"], ["salesforce", "Salesforce"]],
        "quote": "\u201cSince the update my humidifier drops back to 1 every night and I wake up dry.\u201d",
        "jira": "HW-3402",
        "jiraTitle": "Persist humidifier setting across firmware 3.1.4",
        "jiraStatus": "In Progress",
        "jiraClass": "label-accent",
        "assignee": "S. Novak",
        "sprint": "W14 \u00b7 Sprint 31",
        "points": 3,
        "updated": "40 min ago",
        "stage": "In build",
        "roadmapIdx": 2,
        "roadmapNote": "Firmware 3.1.4 regression; setting is not written back to the device profile.",
        "demand": 21,
        "effort": 30,
        "owner": {"name": "S. Novak", "verified": True, "role": "Hardware & masks"},
        "crm": "Enterprise fleet accounts first to report",
        "crmVerified": False,
        "why": "Version clustering on firmware 3.1.4 and a single reproducer (humidifier level reverts overnight). Some reports also name a dry-mouth symptom, so the cluster is cross-checked with quality.",
        "evidence": [
            {"text": "\u201cHumidifier setting won\u2019t stick after the last update.\u201d", "src": "App store \u00b7 iOS", "when": "Mar 23", "prov": "synthetic"},
            {"text": "\u201cResets to level 1 every night; woke with a dry throat.\u201d", "src": "Salesforce case 0098214", "when": "Mar 23", "prov": "synthetic"},
        ],
    },
    {
        "id": "idea-widget",
        "title": "Home-screen widget for the nightly AHI score",
        "pod": "Companion App",
        "priority": "Low",
        "reports": 19,
        "ageDays": 11,
        "sent": "positive",
        "sources": [["appstore", "App store reviews"], ["intercom", "Intercom"]],
        "quote": "\u201cA widget with last night\u2019s AHI and mask hours would be perfect.\u201d",
        "jira": "APP-2260",
        "jiraTitle": "iOS home-screen widget for nightly results",
        "jiraStatus": "Backlog",
        "jiraClass": "label-neutral",
        "assignee": "J. Ferreira (proposed)",
        "sprint": "W17 \u00b7 Unscheduled",
        "points": 3,
        "updated": "1w ago",
        "stage": "Later",
        "roadmapIdx": 4,
        "roadmapNote": "Nice-to-have engagement feature; no safety dimension.",
        "demand": 19,
        "effort": 20,
        "owner": {"name": "J. Ferreira (proposed)", "verified": False, "role": "Companion App"},
        "crm": "Consumer-driven \u00b7 no account concentration",
        "crmVerified": False,
        "why": "Consistent low-frequency request, positive framing, no cluster risk. Kept on the later lane because demand is modest.",
        "evidence": [
            {"text": "\u201cWidget with AHI and hours used would be so handy.\u201d", "src": "App store \u00b7 iOS", "when": "Mar 11", "prov": "synthetic"},
            {"text": "\u201cAny chance of a home-screen widget?\u201d", "src": "Intercom conversation", "when": "Mar 12", "prov": "synthetic"},
        ],
    },
    {
        "id": "idea-localization",
        "title": "Add Spanish and Portuguese to the app",
        "pod": "Platform & Data",
        "priority": "Medium",
        "reports": 17,
        "ageDays": 14,
        "sent": "neutral",
        "sources": [["appstore", "App store reviews"], ["gmail", "Email + Gmail"]],
        "quote": "\u201cMy parents only read Spanish \u2014 the whole setup screen is English.\u201d",
        "jira": "PLAT-2087",
        "jiraTitle": "Localize companion app (es, pt-BR)",
        "jiraStatus": "Backlog",
        "jiraClass": "label-neutral",
        "assignee": "L. Rossi",
        "sprint": "W17 \u00b7 Unscheduled",
        "points": 5,
        "updated": "5d ago",
        "stage": "Later",
        "roadmapIdx": 4,
        "roadmapNote": "Depends on the string-extraction ticket in the platform backlog.",
        "demand": 17,
        "effort": 44,
        "owner": {"name": "L. Rossi", "verified": True, "role": "Platform & data"},
        "crm": "Washington-state clinic account raised it twice",
        "crmVerified": False,
        "why": "A regional demand signal grouped from app reviews and one clinic email. Not a safety issue; a growth and accessibility gap.",
        "evidence": [
            {"text": "\u201cPlease add Spanish, my father cannot use it.\u201d", "src": "App store \u00b7 iOS", "when": "Mar 8", "prov": "synthetic"},
            {"text": "\u201cOur Spanish-speaking patients need the setup screens localized.\u201d", "src": "Email msg-5110", "when": "Mar 9", "prov": "synthetic"},
        ],
    },
    {
        "id": "idea-notifications",
        "title": "Weekly summary instead of per-event push notifications",
        "pod": "Companion App",
        "priority": "Low",
        "reports": 15,
        "ageDays": 10,
        "sent": "mixed",
        "sources": [["zendesk", "Zendesk"], ["appstore", "App store reviews"]],
        "quote": "\u201cToo many pushes. One weekly digest would be enough.\u201d",
        "jira": "APP-2271",
        "jiraTitle": "Notification preferences: weekly digest option",
        "jiraStatus": "Backlog",
        "jiraClass": "label-neutral",
        "assignee": "J. Ferreira",
        "sprint": "W17 \u00b7 Unscheduled",
        "points": 3,
        "updated": "6d ago",
        "stage": "Later",
        "roadmapIdx": 4,
        "roadmapNote": "Folds into the notification-preferences epic.",
        "demand": 15,
        "effort": 22,
        "owner": {"name": "J. Ferreira", "verified": True, "role": "Companion App"},
        "crm": "Consumer-driven \u00b7 no account concentration",
        "crmVerified": False,
        "why": "Notification fatigue, not an alarm complaint. Grouped separately from the alert-precision work so it cannot be read as a safety signal.",
        "evidence": [
            {"text": "\u201cNotifications for everything \u2014 just send a weekly summary.\u201d", "src": "Zendesk #47620", "when": "Mar 12", "prov": "synthetic"},
            {"text": "\u201cLet me turn off daily pushes but keep the report.\u201d", "src": "App store \u00b7 iOS", "when": "Mar 13", "prov": "synthetic"},
        ],
    },
    {
        "id": "idea-readability",
        "title": "Larger font and higher contrast in therapy charts",
        "pod": "Design System",
        "priority": "Low",
        "reports": 13,
        "ageDays": 12,
        "sent": "neutral",
        "sources": [["slack", "Slack"], ["zendesk", "Zendesk"]],
        "quote": "\u201cIn dark mode the alert line is nearly invisible against the grid.\u201d",
        "jira": "DS-0442",
        "jiraTitle": "Contrast and type tokens for therapy charts",
        "jiraStatus": "Backlog",
        "jiraClass": "label-neutral",
        "assignee": "Unassigned",
        "sprint": "Unscheduled",
        "points": 3,
        "updated": "1w ago",
        "stage": "Later",
        "roadmapIdx": 4,
        "roadmapNote": "Accessibility debt. Low demand but blocks the dark-theme release checklist.",
        "demand": 13,
        "effort": 22,
        "owner": {"name": "Design System pod", "verified": False, "role": "Platform design"},
        "crm": "Internal + partner feedback",
        "crmVerified": False,
        "why": "An accessibility issue rather than a feature request: contrast failures are grouped because they share one token root cause across all charts.",
        "evidence": [
            {"text": "\u201cGrid and alert line are almost the same colour in dark mode.\u201d", "src": "Slack #design-system", "when": "Mar 12", "prov": "synthetic"},
        ],
    },
]

PODS = [
    {"id": "companion-app", "mono": "CA", "name": "Companion App", "lead": "R. Okafor", "leadVerified": True, "pm": "Khizar Kashif", "okr": "Sync reliability & activation", "health": "at-risk", "complaints": 286},
    {"id": "algorithms-safety", "mono": "AS", "name": "Algorithms & Safety", "lead": "Dr. L. Park", "leadVerified": True, "pm": "N. Haddad", "okr": "Alert precision & clinical safety", "health": "critical", "complaints": 118},
    {"id": "clinical-workflows", "mono": "CW", "name": "Clinical Workflows", "lead": "M. Adeyemi", "leadVerified": False, "pm": "S. Iyer", "okr": "Clinician handoff & reporting", "health": "ok", "complaints": 71},
    {"id": "hardware-masks", "mono": "HM", "name": "Hardware & Masks", "lead": "S. Novak", "leadVerified": True, "pm": "T. Berg", "okr": "Mask fit, humidification & power", "health": "at-risk", "complaints": 126},
    {"id": "design-system", "mono": "DS", "name": "Design System", "lead": "Unassigned", "leadVerified": False, "pm": "J. Meyer", "okr": "Accessibility & visual tokens", "health": "ok", "complaints": 32},
    {"id": "platform-data", "mono": "PD", "name": "Platform & Data", "lead": "K. Nakamura", "leadVerified": True, "pm": "L. Rossi", "okr": "Intake pipeline & normalization", "health": "ok", "complaints": 71},
]

QUALITY = [
    {
        "id": "CP-2214", "record": "appstore-2214", "classification": "complaint",
        "quote": "App sync hangs repeatedly at 99%. Patient unable to export nightly pressure reports for clinic follow-up.",
        "source": "App store \u00b7 iOS", "sourceId": "appstore", "product": "Aeris Air app", "version": "4.2.1",
        "theme": "sync-reliability", "confidence": 0.62, "mdr": True, "flags": ["clinical_risk_without_known_harm"],
        "reason": "The report links a software failure to a missed clinical follow-up (nightly pressure reports for a clinic). The model cannot rule out that the missed export delayed care, so it raises a potential MDR hint for human judgement. Confidence sits in the low-uncertainty band at 0.62 because harm is implied rather than stated.",
        "fta": "FTA-2026-0443", "ftaNote": "Fault-tree node: export-path failure \u2192 delayed clinical review.",
        "related": 3, "ageDays": 0.01, "when": "18 min ago",
    },
    {
        "id": "CP-2213", "record": "zendesk-2213", "classification": "complaint",
        "quote": "Stalls at 99% when two therapy profiles are active; dual-profile switching causes a local socket hang.",
        "source": "Support \u00b7 Zendesk", "sourceId": "zendesk", "product": "Aeris Air app", "version": "4.2.1",
        "theme": "sync-reliability", "confidence": 0.31, "mdr": False, "flags": [],
        "reason": "Same failure signature as CP-2214 but the text describes a usability freeze with no clinical consequence stated. Classified as a complaint candidate because it names a device/companion-app malfunction, but no MDR hint is raised.",
        "fta": "FTA-2026-0443", "ftaNote": "Same fault-tree node as CP-2214.",
        "related": 6, "ageDays": 0.03, "when": "44 min ago",
    },
    {
        "id": "CP-2208", "record": "gmail-2208", "classification": "complaint",
        "quote": "The device reported an apnea event during the night and the alarm never sounded. We only found out at the clinic.",
        "source": "Email \u00b7 Gmail", "sourceId": "gmail", "product": "Aeris Air CPAP", "version": "n/a",
        "theme": "false-negative", "confidence": 0.71, "mdr": True, "flags": ["patient_harm_reported"],
        "reason": "Explicit statement that a missed alarm coincided with a clinical event. This is the clearest MDR candidate in the queue: a reported harm event combined with a device malfunction. Routed to quality with high review priority \u2014 no automatic legal determination is made.",
        "fta": "FTA-2026-0419", "ftaNote": "Fault-tree node: alarm suppression \u2192 missed event.",
        "related": 2, "ageDays": 0.05, "when": "1h ago",
    },
    {
        "id": "CP-2202", "record": "email-5043", "classification": "complaint",
        "quote": "false low-pressure alerts most nights [excerpt]",
        "source": "Email \u00b7 Gmail", "sourceId": "gmail", "product": "Aeris Air app", "version": None,
        "theme": "false-alarm", "confidence": 0.44, "mdr": False, "flags": ["clinical_risk_without_known_harm"],
        "reason": "Repeated false alarms can cause alarm fatigue, which the rubric treats as a clinical-risk-without-known-harm flag even though no harm is reported. Uncertainty sits in the mid band, so it stays human-reviewed.",
        "fta": "FTA-2026-0402", "ftaNote": "Fault-tree node: threshold mis-tune \u2192 nuisance alarm.",
        "related": 11, "ageDays": 0.1, "when": "2h ago",
    },
    {
        "id": "CP-2199", "record": "appstore-2199", "classification": "complaint",
        "quote": "Mask cushion seam split after two weeks and the leak alarm kept firing all night.",
        "source": "App store \u00b7 iOS", "sourceId": "appstore", "product": "Aeris Air mask", "version": "n/a",
        "theme": "wearability", "confidence": 0.53, "mdr": False, "flags": [],
        "reason": "Physical device failure (cushion seam) rather than software. Classified as a complaint candidate because it concerns device performance; no MDR hint because the user detected the leak and swapped the cushion.",
        "fta": "FTA-2026-0398", "ftaNote": "Fault-tree node: cushion durability \u2192 leak.",
        "related": 5, "ageDays": 0.15, "when": "3h ago",
    },
    {
        "id": "CP-2196", "record": "salesforce-2196", "classification": "complaint",
        "quote": "Field-safety notice mentioned humidifier lot 409-TX on the support call \u2014 is our clinic inventory affected?",
        "source": "Salesforce", "sourceId": "salesforce", "product": "Aeris Air humidifier", "version": "lot 409-TX",
        "theme": "field-safety", "confidence": 0.66, "mdr": True, "flags": ["field_safety_correction"],
        "reason": "Mentions a field-safety / recall context by lot number. The model routes it to quality with a potential MDR hint because field-corrective language is present; the actual determination belongs to the quality reviewer and legal.",
        "fta": "FTA-2026-0411", "ftaNote": "Fault-tree node: lot traceability \u2192 field action.",
        "related": 4, "ageDays": 0.2, "when": "4h ago",
    },
    {
        "id": "CP-2191", "record": "zoom-2191", "classification": "complaint",
        "quote": "[transcript] The clinic made titration decisions on stale data because the app stopped syncing for three nights.",
        "source": "Zoom \u00b7 clinic call transcript", "sourceId": "zoom", "product": "Aeris Air app", "version": "4.2.1",
        "theme": "sync-reliability", "confidence": 0.58, "mdr": True, "flags": ["clinical_risk_without_known_harm"],
        "reason": "A recorded clinician call describes clinical decisions taken on stale therapy data after a sync gap. It is a candidate, not a determination: the reviewer decides whether the gap affected care and whether an MDR report is warranted.",
        "fta": "FTA-2026-0443", "ftaNote": "Fault-tree node: sync gap \u2192 stale clinical data.",
        "related": 3, "ageDays": 5, "when": "5d ago",
    },
    {
        "id": "CP-2188", "record": "intercom-2188", "classification": "complaint",
        "quote": "Tonight's session logged as 0.0 hours; my nurse flagged it as a possible therapy failure.",
        "source": "Intercom \u00b7 in-app", "sourceId": "intercom", "product": "Aeris Air app", "version": "4.2.1",
        "theme": "data-integrity", "confidence": 0.49, "mdr": False, "flags": [],
        "reason": "A logged session of 0.0 hours is a data-integrity defect, not a stated harm. Flagged as a complaint candidate because it can cause a clinician to misinterpret adherence; no MDR hint on the current evidence.",
        "fta": "FTA-2026-0450", "ftaNote": "Fault-tree node: session write error \u2192 wrong adherence.",
        "related": 2, "ageDays": 0.12, "when": "3h ago",
    },
    {
        "id": "CP-2185", "record": "zendesk-2185", "classification": "complaint",
        "quote": "Device powered off in the middle of the night and no alarm or notification was raised.",
        "source": "Support \u00b7 Zendesk", "sourceId": "zendesk", "product": "Aeris Air CPAP", "version": "3.1.4",
        "theme": "power-interruption", "confidence": 0.55, "mdr": True, "flags": ["patient_harm_reported"],
        "reason": "An unannounced therapy interruption overnight with the user reporting a headache and daytime sleepiness the next morning. Harm is reported, so the model raises a potential MDR hint; the reviewer decides causality.",
        "fta": "FTA-2026-0427", "ftaNote": "Fault-tree node: power loss \u2192 unattended therapy gap.",
        "related": 7, "ageDays": 0.3, "when": "7h ago",
    },
]

PIPELINE = [
    {"name": "Raw intake", "detail": "Sources \u2192 unchanged storage", "pct": 100, "state": "done"},
    {"name": "AI normalization", "detail": "Extract into schema v1.1 JSON", "pct": 97, "state": "done"},
    {"name": "Classifier", "detail": "Eligible records only", "pct": 90, "state": "running"},
    {"name": "Human review", "detail": "Quality + product paths diverge", "pct": 61, "state": "running"},
]

CONNECTORS = [
    {"id": "salesforce", "name": "Salesforce", "kind": "CRM \u00b7 cases + accounts", "status": "ok", "last": "4m ago", "records": "452", "auth": "oauth2", "env": ["SALESFORCE_INSTANCE_URL", "SALESFORCE_CLIENT_ID", "SALESFORCE_CLIENT_SECRET", "SALESFORCE_REFRESH_TOKEN"], "mode": "synthetic"},
    {"id": "zendesk", "name": "Zendesk", "kind": "Support tickets", "status": "ok", "last": "4m ago", "records": "431", "auth": "api_token", "env": ["ZENDESK_SUBDOMAIN", "ZENDESK_EMAIL", "ZENDESK_API_TOKEN"], "mode": "synthetic"},
    {"id": "gmail", "name": "Gmail", "kind": "feedback_mail", "status": "ok", "last": "6m ago", "records": "322", "auth": "oauth2", "env": ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"], "mode": "synthetic"},
    {"id": "slack", "name": "Slack", "kind": "Dev + VoC channels", "status": "ok", "last": "2m ago", "records": "268", "auth": "bot_token", "env": ["SLACK_BOT_TOKEN", "SLACK_CHANNEL_ID"], "mode": "synthetic"},
    {"id": "zoom", "name": "Zoom + Granola", "kind": "Meeting transcripts", "status": "warn", "last": "38m ago", "records": "197", "auth": "s2s_oauth", "env": ["ZOOM_ACCOUNT_ID", "ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET"], "mode": "synthetic"},
    {"id": "intercom", "name": "Intercom", "kind": "In-app conversations", "status": "ok", "last": "9m ago", "records": "54", "auth": "access_token", "env": ["INTERCOM_ACCESS_TOKEN"], "mode": "synthetic"},
    {"id": "appstore", "name": "App store reviews", "kind": "iOS \u00b7 public", "status": "ok", "last": "22m ago", "records": "149", "auth": "public", "env": ["APPSTORE_APP_ID", "APPSTORE_COUNTRY"], "mode": "synthetic"},
]

TECH = ["Zoom", "Google Workspace", "Gmail", "Slack", "Salesforce", "Zendesk", "Intercom", "Granola", "Veeva", "Jira"]

ROADMAP = {
    "Now \u00b7 W14": [
        {"title": "Nightly sync stalls at 99%", "jira": "APP-2214", "pod": "Companion App", "pct": 70},
        {"title": "False low-pressure alerts during sleep", "jira": "SAFE-1108", "pod": "Algorithms & Safety", "pct": 45},
        {"title": "Humidifier setting resets (fw 3.1.4)", "jira": "HW-3402", "pod": "Hardware & Masks", "pct": 60},
    ],
    "Next \u00b7 W15\u201316": [
        {"title": "Clinician PDF export", "jira": "CLIN-770", "pod": "Clinical Workflows", "pct": 10},
        {"title": "Mask leak recalibration", "jira": "HW-3391", "pod": "Hardware & Masks", "pct": 30},
        {"title": "HealthKit write-back", "jira": "PLAT-2044", "pod": "Platform & Data", "pct": 5},
    ],
    "Later \u00b7 W17+": [
        {"title": "Per-profile alarm customization", "jira": "SAFE-1142", "pod": "Algorithms & Safety", "pct": 15},
        {"title": "Chart contrast & type tokens", "jira": "DS-0442", "pod": "Design System", "pct": 0},
    ],
}

SHIPPED = [
    {"title": "Profile-switch socket hang fixed", "jira": "APP-2015", "when": "Shipped W14"},
    {"title": "Firmware 3.1.3 leak-baseline patch", "jira": "HW-3360", "when": "Shipped W13"},
    {"title": "Duplicated alert dedupe in app", "jira": "APP-1955", "when": "Shipped W13"},
    {"title": "Granola transcript connector", "jira": "PLAT-220", "when": "Shipped W13"},
]

QMS = [
    {"id": "veeva", "mono": "VV", "name": "Veeva Vault Quality", "desc": "Complaint + nonconformance objects, life-sciences QMS.", "status": "connected", "tone": "success", "detail": "Sandbox \u00b7 24 packs pushed"},
    {"id": "mastercontrol", "mono": "MC", "name": "MasterControl", "desc": "Quality Events and CAPA, life-sciences QMS.", "status": "available", "tone": "neutral", "detail": "Not connected"},
    {"id": "greenlight", "mono": "GG", "name": "Greenlight Guru", "desc": "Medical-device QMS with complaint workflow.", "status": "available", "tone": "neutral", "detail": "Not connected"},
    {"id": "trackwise", "mono": "TW", "name": "TrackWise (Honeywell)", "desc": "Enterprise quality-management records.", "status": "available", "tone": "neutral", "detail": "Not connected"},
    {"id": "compliancequest", "mono": "CQ", "name": "ComplianceQuest", "desc": "Salesforce-native QMS and risk module.", "status": "available", "tone": "neutral", "detail": "Not connected"},
]

DESTS = [
    {"id": "jira", "name": "Jira", "desc": "Product feedback \u2192 ideas \u2192 tickets, with roadmap evidence.", "status": "connected", "tone": "success", "detail": "6 pods mapped"},
    {"id": "salesforce", "name": "Salesforce CRM", "desc": "Conditional account + ARR context on ideas.", "status": "connected", "tone": "success", "detail": "Read-only"},
    {"id": "zendesk", "name": "Zendesk", "desc": "Write a linked ticket when a complaint is confirmed.", "status": "available", "tone": "neutral", "detail": "Not connected"},
]

for _idea in IDEAS:
    for _ev in _idea["evidence"]:
        _ev["url"] = evidence_url(_ev["src"])

DATA = {
    "sources": SOURCES,
    "sourceFeed": SOURCE_FEED,
    "split": SPLIT,
    "trend": TREND,
    "ideas": IDEAS,
    "pods": PODS,
    "quality": QUALITY,
    "pipeline": PIPELINE,
    "connectors": CONNECTORS,
    "tech": TECH,
    "roadmap": ROADMAP,
    "shipped": SHIPPED,
    "qms": QMS,
    "dests": DESTS,
    "company": {"name": "Aeris Health", "product": "Aeris Air CPAP", "app": "Aeris Air app", "synthetic": True},
}

DATA_JS = """/* Test Flight \u2014 synthetic dataset (schema v1.1, fictional company Aeris Health).
 * Generated by scripts/gen_dataset.py \u2014 do not edit by hand.
 * Embedded so the console runs with zero backend. `TF_DATA.apply(next)` lets
 * assets/backend.js replace any slice with live API data at runtime. */
(function () {
  var DATA = %s;
  var KEYS = {
    sources: 'SOURCES', sourceFeed: 'SOURCE_FEED', split: 'SPLIT', trend: 'TREND',
    ideas: 'IDEAS', pods: 'PODS', quality: 'QUALITY', pipeline: 'PIPELINE',
    connectors: 'CONNECTORS', tech: 'TECH', roadmap: 'ROADMAP', shipped: 'SHIPPED',
    qms: 'QMS', dests: 'DESTS'
  };
  function bind(d) {
    for (var key in KEYS) { if (Object.prototype.hasOwnProperty.call(d, key)) window[KEYS[key]] = d[key]; }
  }
  window.TF_DATA = {
    demo: DATA,
    source: 'demo',
    bind: bind,
    apply: function (next) { bind(Object.assign({}, DATA, next || {})); this.source = "api"; }
  };
  bind(DATA);
})();
""" % json.dumps(DATA, indent=2, ensure_ascii=False)


def main():
    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "assets").mkdir(exist_ok=True)
    (ROOT / "data" / "dataset.json").write_text(json.dumps(DATA, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (ROOT / "assets" / "data.js").write_text(DATA_JS, encoding="utf-8")
    total = sum(s["value"] for s in SOURCES)
    excluded = sum(s["excluded"] for s in SOURCES)
    print(f"wrote data/dataset.json and assets/data.js")
    print(f"sources={len(SOURCES)} total={total} excluded={excluded} ideas={len(IDEAS)} quality={len(QUALITY)} pods={len(PODS)}")


if __name__ == "__main__":
    main()