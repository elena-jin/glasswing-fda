/* Test Flight — synthetic dataset (aligned to the brief schema v1.1).
 * Embedded so the console runs with zero backend. `TF_DATA.apply(next)` lets
 * assets/backend.js replace any slice with live API data at runtime. */
(function () {
  var DATA = {
  "sources": [
    {
      "id": "salesforce",
      "name": "Salesforce",
      "value": 412,
      "complaints": 178,
      "product": 176,
      "excluded": 58
    },
    {
      "id": "zendesk",
      "name": "Zendesk",
      "value": 386,
      "complaints": 165,
      "product": 166,
      "excluded": 55
    },
    {
      "id": "gmail",
      "name": "Email + Gmail",
      "value": 298,
      "complaints": 121,
      "product": 130,
      "excluded": 47
    },
    {
      "id": "slack",
      "name": "Slack",
      "value": 254,
      "complaints": 74,
      "product": 137,
      "excluded": 43
    },
    {
      "id": "zoom",
      "name": "Zoom + Granola",
      "value": 172,
      "complaints": 41,
      "product": 105,
      "excluded": 26
    },
    {
      "id": "appstore",
      "name": "App store reviews",
      "value": 136,
      "complaints": 45,
      "product": 72,
      "excluded": 19
    }
  ],
  "sourceFeed": {
    "salesforce": [
      {
        "t": "Recall notice mentioned lot 409-TX — is our inventory affected?",
        "cls": "label-danger",
        "label": "Potential MDR",
        "when": "6h ago"
      },
      {
        "t": "Account asks for a batch traceability report on a recent order.",
        "cls": "label-accent",
        "label": "Product feedback",
        "when": "9h ago"
      },
      {
        "t": "Case cites a delivery delay on replacement sensors.",
        "cls": "label-warning",
        "label": "Complaint",
        "when": "1d ago"
      }
    ],
    "zendesk": [
      {
        "t": "Stalls at 99% when two profiles are active; local socket hang.",
        "cls": "label-warning",
        "label": "Complaint",
        "when": "44 min ago"
      },
      {
        "t": "Three false alarms this week, each woke the whole household.",
        "cls": "label-warning",
        "label": "Complaint",
        "when": "2d ago"
      },
      {
        "t": "Can the app email a clean PDF to my clinic instead of screenshots?",
        "cls": "label-accent",
        "label": "Product feedback",
        "when": "6d ago"
      }
    ],
    "gmail": [
      {
        "t": "False low alerts most nights [excerpt].",
        "cls": "label-warning",
        "label": "Complaint",
        "when": "2h ago"
      },
      {
        "t": "Device reported a low reading during an episode; the alarm never sounded.",
        "cls": "label-danger",
        "label": "Potential MDR",
        "when": "1d ago"
      },
      {
        "t": "Request: a weekly summary email instead of per-alert noise.",
        "cls": "label-accent",
        "label": "Product feedback",
        "when": "8d ago"
      }
    ],
    "slack": [
      {
        "t": "Chart contrast in dark mode is nearly invisible against the grid.",
        "cls": "label-accent",
        "label": "Product feedback",
        "when": "5h ago"
      },
      {
        "t": "Nightly upload never completes; exporting the reports manually.",
        "cls": "label-warning",
        "label": "Complaint",
        "when": "1d ago"
      },
      {
        "t": "Beta thread: the pairing loop is the worst part of setup.",
        "cls": "label-accent",
        "label": "Product feedback",
        "when": "9d ago"
      }
    ],
    "zoom": [
      {
        "t": "[transcript] The export step is the most manual part of my morning.",
        "cls": "label-accent",
        "label": "Product feedback",
        "when": "6d ago"
      },
      {
        "t": "[transcript] Clinician asks for a shareable pressure report for the clinic.",
        "cls": "label-accent",
        "label": "Product feedback",
        "when": "12d ago"
      },
      {
        "t": "[transcript] Onboarding call flagged BLE pairing friction.",
        "cls": "label-accent",
        "label": "Product feedback",
        "when": "18d ago"
      }
    ],
    "appstore": [
      {
        "t": "App sync hangs repeatedly at 99% after the update.",
        "cls": "label-warning",
        "label": "Complaint",
        "when": "18 min ago"
      },
      {
        "t": "Sensor adhesive failed after a shower; the patch fell off overnight.",
        "cls": "label-warning",
        "label": "Complaint",
        "when": "3h ago"
      },
      {
        "t": "Battery used to last two days, now barely one.",
        "cls": "label-accent",
        "label": "Product feedback",
        "when": "7d ago"
      }
    ]
  },
  "split": [
    {
      "name": "Product feedback",
      "value": 786,
      "color": "var(--accent)"
    },
    {
      "name": "Complaint candidates",
      "value": 624,
      "color": "var(--danger)"
    }
  ],
  "trend": {
    "labels": [
      "W3",
      "W4",
      "W5",
      "W6",
      "W7",
      "W8",
      "W9",
      "W10",
      "W11",
      "W12",
      "W13",
      "W14"
    ],
    "quality": [
      38,
      42,
      40,
      47,
      44,
      51,
      49,
      55,
      53,
      58,
      61,
      64
    ],
    "product": [
      52,
      55,
      60,
      58,
      63,
      66,
      64,
      70,
      72,
      69,
      75,
      78
    ]
  },
  "ideas": [
    {
      "id": "idea-sync-stall",
      "title": "Nightly sync stalls at 99% on iOS",
      "pod": "Mobile Platform",
      "priority": "High",
      "reports": 47,
      "ageDays": 2,
      "sent": "negative",
      "sources": [
        [
          "appstore",
          "App store reviews"
        ],
        [
          "zendesk",
          "Zendesk"
        ],
        [
          "slack",
          "Slack"
        ]
      ],
      "quote": "“App sync hangs repeatedly at 99%. Patient unable to export nightly pressure reports for clinic follow-up.”",
      "jira": "CPAP-2214",
      "jiraTitle": "Fix sync deadlock on nightly upload (iOS)",
      "jiraStatus": "In Review",
      "jiraClass": "label-accent",
      "assignee": "R. Okafor",
      "sprint": "W14 · Sprint 31",
      "points": 8,
      "updated": "18 min ago",
      "stage": "In build",
      "roadmapIdx": 2,
      "roadmapNote": "Scoped for the W14 freeze. Two related reports currently open against the same socket path.",
      "demand": 47,
      "effort": 62,
      "owner": {
        "name": "R. Okafor",
        "verified": true,
        "role": "Mobile Platform lead"
      },
      "crm": "2 enterprise accounts in cluster · combined ARR $340k",
      "crmVerified": false,
      "why": "Nine independent sources describe an identical hang at 99% after the 4.2.1 update, all resolving only when the app is force-quit. The similarity and version clustering is what promoted this from isolated reports to one idea.",
      "evidence": [
        {
          "text": "“Sync hangs at 99% every time on my iPhone after the update.”",
          "src": "App store · iOS",
          "when": "Mar 21",
          "prov": "synthetic"
        },
        {
          "text": "“Two profiles active and the socket just hangs; support had no fix.”",
          "src": "Zendesk #48219",
          "when": "Mar 22",
          "prov": "synthetic"
        },
        {
          "text": "“Nightly upload never completes, I export manually at the clinic.”",
          "src": "Slack #voice-of-customer",
          "when": "Mar 23",
          "prov": "synthetic"
        }
      ]
    },
    {
      "id": "idea-false-alarm",
      "title": "False low alerts during sleep",
      "pod": "Algorithms & Safety",
      "priority": "Critical",
      "reports": 31,
      "ageDays": 3,
      "sent": "negative",
      "sources": [
        [
          "gmail",
          "Email + Gmail"
        ],
        [
          "appstore",
          "App store reviews"
        ],
        [
          "zendesk",
          "Zendesk"
        ]
      ],
      "quote": "“false low alerts most nights — I wake up panicked and can’t tell if it is real.”",
      "jira": "CARD-1108",
      "jiraTitle": "Reduce false-low alert rate in sleep window",
      "jiraStatus": "In Progress",
      "jiraClass": "label-accent",
      "assignee": "Dr. L. Park",
      "sprint": "W14 · Sprint 31",
      "points": 13,
      "updated": "1h ago",
      "stage": "In build",
      "roadmapIdx": 2,
      "roadmapNote": "Algorithm threshold work with an interim clinician-reviewed suppression rule.",
      "demand": 31,
      "effort": 84,
      "owner": {
        "name": "Dr. L. Park",
        "verified": true,
        "role": "Clinical algorithms"
      },
      "crm": "Cross-account · no single account concentration",
      "crmVerified": false,
      "why": "Reports span 11 days and three sources but converge on one threshold band (00:00–05:00). Clinical risk without a known harm event, so it is flagged to quality as well as product.",
      "evidence": [
        {
          "text": "“false low alerts most nights [excerpt]”",
          "src": "Email msg-5043",
          "when": "Mar 23",
          "prov": "synthetic"
        },
        {
          "text": "“Alarm fired at 2am and there was nothing wrong on the repeat reading.”",
          "src": "App store · iOS",
          "when": "Mar 19",
          "prov": "synthetic"
        },
        {
          "text": "“Three false alarms this week, each woke the whole household.”",
          "src": "Zendesk #48107",
          "when": "Mar 20",
          "prov": "synthetic"
        }
      ]
    },
    {
      "id": "idea-export-pdf",
      "title": "Export nightly pressure reports as clinician PDF",
      "pod": "Clinical Workflows",
      "priority": "Medium",
      "reports": 22,
      "ageDays": 6,
      "sent": "mixed",
      "sources": [
        [
          "zendesk",
          "Zendesk"
        ],
        [
          "zoom",
          "Zoom + Granola"
        ]
      ],
      "quote": "“I still print screenshots for the clinic. A single PDF would replace my whole morning.”",
      "jira": "CLIN-770",
      "jiraTitle": "Clinician PDF export for pressure reports",
      "jiraStatus": "Planned",
      "jiraClass": "label-info",
      "assignee": "Unassigned",
      "sprint": "W16 · Backlog",
      "points": 5,
      "updated": "2d ago",
      "stage": "Planned",
      "roadmapIdx": 3,
      "roadmapNote": "High-demand, low-effort. Best candidate to pull forward into W15 if capacity opens.",
      "demand": 22,
      "effort": 34,
      "owner": {
        "name": "M. Adeyemi (proposed)",
        "verified": false,
        "role": "Clinical workflows"
      },
      "crm": "3 clinic accounts requested this on calls",
      "crmVerified": false,
      "why": "Recurring request across support tickets and two recorded Zoom calls. Not a safety signal; a workflow gap. Low effort relative to demand.",
      "evidence": [
        {
          "text": "“Can the app email a clean PDF to my clinic instead of screenshots?”",
          "src": "Zendesk #47980",
          "when": "Mar 18",
          "prov": "synthetic"
        },
        {
          "text": "“[transcript] the export step is the most manual part of my morning”",
          "src": "Zoom call · clinic onboarding",
          "when": "Mar 17",
          "prov": "paraphrased public"
        }
      ]
    },
    {
      "id": "idea-battery",
      "title": "Battery drain during continuous monitoring",
      "pod": "Hardware",
      "priority": "High",
      "reports": 29,
      "ageDays": 7,
      "sent": "negative",
      "sources": [
        [
          "appstore",
          "App store reviews"
        ],
        [
          "zendesk",
          "Zendesk"
        ],
        [
          "gmail",
          "Email + Gmail"
        ]
      ],
      "quote": "“Monitor is at 20% by 3pm; I have to charge mid-day to make it through.”",
      "jira": "HW-3391",
      "jiraTitle": "Reduce continuous-monitoring power draw",
      "jiraStatus": "In Progress",
      "jiraClass": "label-accent",
      "assignee": "S. Novak",
      "sprint": "W14 · Sprint 31",
      "points": 8,
      "updated": "5h ago",
      "stage": "In build",
      "roadmapIdx": 2,
      "roadmapNote": "Firmware duty-cycle change in bring-up; see the telemetry evidence attached to HW-3391.",
      "demand": 29,
      "effort": 58,
      "owner": {
        "name": "S. Novak",
        "verified": true,
        "role": "Firmware"
      },
      "crm": "Spread across consumer base · no account concentration",
      "crmVerified": false,
      "why": "Telemetry correlates the complaints with a firmware duty-cycle regression introduced in 4.1.8, which is why these reports are grouped rather than treated as device failures.",
      "evidence": [
        {
          "text": "“Battery used to last two days, now barely one.”",
          "src": "App store · iOS",
          "when": "Mar 16",
          "prov": "synthetic"
        },
        {
          "text": "“Continuous mode drains about 8% per hour.”",
          "src": "Zendesk #47855",
          "when": "Mar 17",
          "prov": "synthetic"
        }
      ]
    },
    {
      "id": "idea-pairing",
      "title": "Sensor pairing takes six or more attempts",
      "pod": "Mobile Platform",
      "priority": "Medium",
      "reports": 25,
      "ageDays": 9,
      "sent": "negative",
      "sources": [
        [
          "zendesk",
          "Zendesk"
        ],
        [
          "slack",
          "Slack"
        ],
        [
          "appstore",
          "App store reviews"
        ]
      ],
      "quote": "“New sensor pairing failed six times before it connected. Almost gave up.”",
      "jira": "MOB-1980",
      "jiraTitle": "Improve BLE pairing reliability on first run",
      "jiraStatus": "Planned",
      "jiraClass": "label-info",
      "assignee": "Unassigned",
      "sprint": "W16 · Backlog",
      "points": 5,
      "updated": "3d ago",
      "stage": "Planned",
      "roadmapIdx": 3,
      "roadmapNote": "Onboarding friction; pairs with the activation-funnel work in W16.",
      "demand": 25,
      "effort": 40,
      "owner": {
        "name": "J. Ferreira (proposed)",
        "verified": false,
        "role": "Mobile platform"
      },
      "crm": "Concentrated in new-customer cohort (first 7 days)",
      "crmVerified": false,
      "why": "Most reports come from first-week users and mention the pairing step specifically. Grouped because the failure mode is consistent, not intermittent hardware.",
      "evidence": [
        {
          "text": "“Took me 7 tries to pair the new sensor.”",
          "src": "Zendesk #47701",
          "when": "Mar 15",
          "prov": "synthetic"
        },
        {
          "text": "“Pairing loop is the worst part of setup.”",
          "src": "Slack #beta-feedback",
          "when": "Mar 15",
          "prov": "synthetic"
        }
      ]
    },
    {
      "id": "idea-contrast",
      "title": "Chart color contrast fails in dark mode",
      "pod": "Design System",
      "priority": "Low",
      "reports": 18,
      "ageDays": 12,
      "sent": "neutral",
      "sources": [
        [
          "slack",
          "Slack"
        ],
        [
          "zendesk",
          "Zendesk"
        ]
      ],
      "quote": "“In dark mode the alert line is nearly invisible against the grid.”",
      "jira": "DS-0442",
      "jiraTitle": "Contrast tokens for charts in dark theme",
      "jiraStatus": "Backlog",
      "jiraClass": "label-neutral",
      "assignee": "Unassigned",
      "sprint": "Unscheduled",
      "points": 3,
      "updated": "1w ago",
      "stage": "Later",
      "roadmapIdx": 4,
      "roadmapNote": "Accessibility debt. Low demand but blocks the dark-theme release checklist.",
      "demand": 18,
      "effort": 22,
      "owner": {
        "name": "Design System pod",
        "verified": false,
        "role": "Platform design"
      },
      "crm": "Internal + partner feedback",
      "crmVerified": false,
      "why": "An accessibility issue rather than a feature request: contrast failures are grouped because they share one token root cause across all charts.",
      "evidence": [
        {
          "text": "“Grid and alert line are almost the same colour in dark mode.”",
          "src": "Slack #design-system",
          "when": "Mar 12",
          "prov": "synthetic"
        }
      ]
    },
    {
      "id": "idea-profiles",
      "title": "Two active profiles cause a socket hang",
      "pod": "Mobile Platform",
      "priority": "Medium",
      "reports": 19,
      "ageDays": 4,
      "sent": "negative",
      "sources": [
        [
          "zendesk",
          "Zendesk"
        ],
        [
          "gmail",
          "Email + Gmail"
        ]
      ],
      "quote": "“Switching between two profiles mid-sync freezes the app.”",
      "jira": "MOB-2015",
      "jiraTitle": "Handle profile switch during active sync",
      "jiraStatus": "In Review",
      "jiraClass": "label-accent",
      "assignee": "R. Okafor",
      "sprint": "W14 · Sprint 31",
      "points": 5,
      "updated": "44 min ago",
      "stage": "In build",
      "roadmapIdx": 2,
      "roadmapNote": "Same socket subsystem as the 99% stall — reviewed together.",
      "demand": 19,
      "effort": 44,
      "owner": {
        "name": "R. Okafor",
        "verified": true,
        "role": "Mobile Platform lead"
      },
      "crm": "Multi-profile clinician accounts only",
      "crmVerified": false,
      "why": "Reports share a reproducer (profile switch during sync) and a single crash signature, so they are clustered rather than handled as separate tickets.",
      "evidence": [
        {
          "text": "“Switching profiles while it syncs hangs the app for good.”",
          "src": "Zendesk #48220",
          "when": "Mar 22",
          "prov": "synthetic"
        }
      ]
    }
  ],
  "pods": [
    {
      "id": "mobile-platform",
      "mono": "MP",
      "name": "Mobile Platform",
      "lead": "R. Okafor",
      "leadVerified": true,
      "pm": "A. Castillo",
      "okr": "Activation & sync reliability",
      "health": "at-risk",
      "complaints": 260
    },
    {
      "id": "algorithms-safety",
      "mono": "AS",
      "name": "Algorithms & Safety",
      "lead": "Dr. L. Park",
      "leadVerified": true,
      "pm": "N. Haddad",
      "okr": "Alert precision & clinical safety",
      "health": "critical",
      "complaints": 96
    },
    {
      "id": "clinical-workflows",
      "mono": "CW",
      "name": "Clinical Workflows",
      "lead": "M. Adeyemi",
      "leadVerified": false,
      "pm": "S. Iyer",
      "okr": "Clinician handoff & reporting",
      "health": "ok",
      "complaints": 62
    },
    {
      "id": "hardware",
      "mono": "HW",
      "name": "Hardware",
      "lead": "S. Novak",
      "leadVerified": true,
      "pm": "T. Berg",
      "okr": "Sensor wearability & power",
      "health": "at-risk",
      "complaints": 104
    },
    {
      "id": "design-system",
      "mono": "DS",
      "name": "Design System",
      "lead": "Unassigned",
      "leadVerified": false,
      "pm": "J. Meyer",
      "okr": "Accessibility & visual tokens",
      "health": "ok",
      "complaints": 28
    },
    {
      "id": "platform-data",
      "mono": "PD",
      "name": "Platform & Data",
      "lead": "K. Nakamura",
      "leadVerified": true,
      "pm": "L. Rossi",
      "okr": "Intake pipeline & normalization",
      "health": "ok",
      "complaints": 74
    }
  ],
  "quality": [
    {
      "id": "CP-2214",
      "record": "appstore-2214",
      "classification": "complaint",
      "quote": "App sync hangs repeatedly at 99%. Patient unable to export nightly pressure reports for clinic follow-up.",
      "source": "App store · iOS",
      "sourceId": "appstore",
      "product": "CardioPatch monitor app",
      "version": "4.2.1",
      "theme": "sync-reliability",
      "confidence": 0.62,
      "mdr": true,
      "flags": [
        "clinical_risk_without_known_harm"
      ],
      "reason": "The report links a software failure to a missed clinical follow-up (nightly pressure reports for a clinic). The model cannot rule out that the missed export delayed care, so it raises a potential MDR hint for human judgement. Confidence is deliberately low-uncertainty band 0.62 because harm is implied rather than stated.",
      "fta": "FTA-2026-0443",
      "ftaNote": "Fault-tree node: export-path failure → delayed clinical review.",
      "related": 3,
      "ageDays": 0.01,
      "when": "18 min ago"
    },
    {
      "id": "CP-2213",
      "record": "zendesk-2213",
      "classification": "complaint",
      "quote": "Stalls at 99% when two profiles are active; dual-profile switching causes a local socket hang.",
      "source": "Support · Zendesk",
      "sourceId": "zendesk",
      "product": "CardioPatch monitor app",
      "version": "4.1.8",
      "theme": "sync-reliability",
      "confidence": 0.31,
      "mdr": false,
      "flags": [],
      "reason": "Same failure signature as CP-2214 but the text describes a usability freeze with no clinical consequence stated. Classified as a complaint candidate because it names a device/companion-app malfunction, but no MDR hint is raised.",
      "fta": "FTA-2026-0443",
      "ftaNote": "Same fault-tree node as CP-2214.",
      "related": 6,
      "ageDays": 0.03,
      "when": "44 min ago"
    },
    {
      "id": "CP-2208",
      "record": "gmail-2208",
      "classification": "complaint",
      "quote": "The device reported a low reading during an episode and the alarm never sounded. We only found out at the clinic.",
      "source": "Email · Gmail",
      "sourceId": "gmail",
      "product": "CardioPatch sensor",
      "version": "n/a",
      "theme": "false-negative",
      "confidence": 0.71,
      "mdr": true,
      "flags": [
        "patient_harm_reported"
      ],
      "reason": "Explicit statement that a missed alarm coincided with a clinical episode. This is the clearest MDR candidate in the queue: a reported harm event combined with a device malfunction. Routed to quality with high review priority — no automatic legal determination is made.",
      "fta": "FTA-2026-0419",
      "ftaNote": "Fault-tree node: alarm suppression → missed event.",
      "related": 2,
      "ageDays": 0.05,
      "when": "1h ago"
    },
    {
      "id": "CP-2202",
      "record": "email-5043",
      "classification": "complaint",
      "quote": "false low alerts most nights [excerpt]",
      "source": "Email · Gmail",
      "sourceId": "gmail",
      "product": "CardioPatch monitor app",
      "version": null,
      "theme": "false-alarm",
      "confidence": 0.44,
      "mdr": false,
      "flags": [
        "clinical_risk_without_known_harm"
      ],
      "reason": "Repeated false alarms firmware-side can cause alarm fatigue, which the rubric treats as a clinical-risk-without-known-harm flag even though no harm is reported. Uncertainty sits in the mid band, so it stays human-reviewed.",
      "fta": "FTA-2026-0402",
      "ftaNote": "Fault-tree node: threshold mis-tune → nuisance alarm.",
      "related": 11,
      "ageDays": 0.1,
      "when": "2h ago"
    },
    {
      "id": "CP-2199",
      "record": "appstore-2199",
      "classification": "complaint",
      "quote": "Sensor adhesive failed after a shower and the patch fell off overnight.",
      "source": "App store · iOS",
      "sourceId": "appstore",
      "product": "CardioPatch sensor",
      "version": "n/a",
      "theme": "wearability",
      "confidence": 0.53,
      "mdr": false,
      "flags": [],
      "reason": "Physical device failure (adhesion) rather than software. Classified as a complaint candidate because it concerns device performance; no MDR hint because the user detected the detachment and re-applied.",
      "fta": "FTA-2026-0398",
      "ftaNote": "Fault-tree node: adhesive → sensor loss.",
      "related": 5,
      "ageDays": 0.15,
      "when": "3h ago"
    },
    {
      "id": "CP-2196",
      "record": "salesforce-2196",
      "classification": "complaint",
      "quote": "Recall notice mentioned lot 409-TX on the support call — is our inventory affected?",
      "source": "Salesforce",
      "sourceId": "salesforce",
      "product": "CardioPatch sensor",
      "version": "lot 409-TX",
      "theme": "field-safety",
      "confidence": 0.66,
      "mdr": true,
      "flags": [
        "field_safety_correction"
      ],
      "reason": "Mentions a field-safety / recall context by lot number. The model routes it to quality with a potential MDR hint because field-corrective language is present; the actual determination belongs to the quality reviewer and legal.",
      "fta": "FTA-2026-0411",
      "ftaNote": "Fault-tree node: lot traceability → field action.",
      "related": 4,
      "ageDays": 0.2,
      "when": "4h ago"
    }
  ],
  "pipeline": [
    {
      "name": "Raw intake",
      "detail": "Sources → unchanged storage",
      "pct": 100,
      "state": "done"
    },
    {
      "name": "AI normalization",
      "detail": "Extract into schema v1.1 JSON",
      "pct": 96,
      "state": "done"
    },
    {
      "name": "Classifier",
      "detail": "Eligible records only",
      "pct": 88,
      "state": "running"
    },
    {
      "name": "Human review",
      "detail": "Quality + product paths diverge",
      "pct": 64,
      "state": "running"
    }
  ],
  "connectors": [
    {
      "id": "salesforce",
      "name": "Salesforce",
      "kind": "CRM · cases + accounts",
      "status": "ok",
      "last": "4m ago",
      "records": "412"
    },
    {
      "id": "zendesk",
      "name": "Zendesk",
      "kind": "Support tickets",
      "status": "ok",
      "last": "4m ago",
      "records": "386"
    },
    {
      "id": "gmail",
      "name": "Gmail",
      "kind": "feedback_mail",
      "status": "ok",
      "last": "6m ago",
      "records": "298"
    },
    {
      "id": "slack",
      "name": "Slack",
      "kind": "Dev + VoC channels",
      "status": "ok",
      "last": "2m ago",
      "records": "254"
    },
    {
      "id": "zoom",
      "name": "Zoom + Granola",
      "kind": "Transcripts (mock access)",
      "status": "warn",
      "last": "38m ago",
      "records": "172"
    },
    {
      "id": "intercom",
      "name": "Intercom",
      "kind": "In-app conversations",
      "status": "ok",
      "last": "9m ago",
      "records": "0"
    },
    {
      "id": "appstore",
      "name": "App store reviews",
      "kind": "iOS · public",
      "status": "ok",
      "last": "22m ago",
      "records": "136"
    }
  ],
  "tech": [
    "Zoom",
    "Google Workspace",
    "Gmail",
    "Slack",
    "Salesforce",
    "Zendesk",
    "Intercom",
    "Granola",
    "Veeva",
    "Jira"
  ],
  "roadmap": {
    "Now · W14": [
      {
        "title": "Nightly sync stalls at 99%",
        "jira": "CPAP-2214",
        "pod": "Mobile Platform",
        "pct": 70
      },
      {
        "title": "False low alerts during sleep",
        "jira": "CARD-1108",
        "pod": "Algorithms & Safety",
        "pct": 45
      },
      {
        "title": "Battery drain, continuous mode",
        "jira": "HW-3391",
        "pod": "Hardware",
        "pct": 55
      }
    ],
    "Next · W15–16": [
      {
        "title": "Clinician PDF export",
        "jira": "CLIN-770",
        "pod": "Clinical Workflows",
        "pct": 10
      },
      {
        "title": "BLE pairing reliability",
        "jira": "MOB-1980",
        "pod": "Mobile Platform",
        "pct": 5
      }
    ],
    "Later · W17+": [
      {
        "title": "Dark-theme chart contrast",
        "jira": "DS-0442",
        "pod": "Design System",
        "pct": 0
      }
    ]
  },
  "shipped": [
    {
      "title": "Profile-switch socket hang fixed",
      "jira": "MOB-2015",
      "when": "Shipped W14"
    },
    {
      "title": "Sensor firmware 4.2.2 duty-cycle patch",
      "jira": "HW-3360",
      "when": "Shipped W13"
    },
    {
      "title": "Duplicated alert dedupe in app",
      "jira": "MOB-1955",
      "when": "Shipped W13"
    },
    {
      "title": "Granola transcript connector",
      "jira": "PLT-220",
      "when": "Shipped W13"
    }
  ],
  "qms": [
    {
      "id": "veeva",
      "mono": "VV",
      "name": "Veeva Vault Quality",
      "desc": "Complaint + nonconformance objects, life sciences QMS.",
      "status": "connected",
      "tone": "success",
      "detail": "Sandbox · 24 packs pushed"
    },
    {
      "id": "mastercontrol",
      "mono": "MC",
      "name": "MasterControl",
      "desc": "Quality Events and CAPA, life-sciences QMS.",
      "status": "available",
      "tone": "neutral",
      "detail": "Not connected"
    },
    {
      "id": "greenlight",
      "mono": "GG",
      "name": "Greenlight Guru",
      "desc": "Medical-device QMS with complaint workflow.",
      "status": "available",
      "tone": "neutral",
      "detail": "Not connected"
    },
    {
      "id": "trackwise",
      "mono": "TW",
      "name": "TrackWise (Honeywell)",
      "desc": "Enterprise quality-management records.",
      "status": "available",
      "tone": "neutral",
      "detail": "Not connected"
    },
    {
      "id": "compliancequest",
      "mono": "CQ",
      "name": "ComplianceQuest",
      "desc": "Salesforce-native QMS and risk module.",
      "status": "available",
      "tone": "neutral",
      "detail": "Not connected"
    }
  ],
  "dests": [
    {
      "id": "jira",
      "name": "Jira",
      "desc": "Product feedback → ideas → tickets, with roadmap evidence.",
      "status": "connected",
      "tone": "success",
      "detail": "6 pods mapped"
    },
    {
      "id": "salesforce",
      "name": "Salesforce CRM",
      "desc": "Conditional account + ARR context on ideas.",
      "status": "connected",
      "tone": "success",
      "detail": "Read-only"
    },
    {
      "id": "zendesk",
      "name": "Zendesk",
      "desc": "Write a linked ticket when a complaint is confirmed.",
      "status": "available",
      "tone": "neutral",
      "detail": "Not connected"
    }
  ]
};
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
