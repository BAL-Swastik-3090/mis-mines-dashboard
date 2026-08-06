/* ============================================================================
   MINES MODULE — drop-in data object for
   "BAL_IT_Module-wise_Management_Review_Dashboard.html"

   HOW TO MERGE (3 edits, no other changes needed):

   1) Add the CSS hero rule next to the other .dhero.h-* rules:
        .dhero.h-mines::before{background:#0E6E6E}

   2) Paste the `mines:{...}` block below inside the existing `const D = { ... }`
      object (after `hr:{...}`).

   3) Add 'mines' to the ORDER array:
        const ORDER=['overview','furnace','finance','scm','crm','she','hr','mines'];

   Optionally update the overview KPI strip: total projects 81 -> 97,
   live 54 -> 64, in progress 12 -> 15, planned 12 -> 15.
   Implementation rate becomes 66%.

   4) IMPORTANT — the host template renders a "Utilization of Each Project"
      section for every module tab. The Mines module does not report utilization,
      so that section must be suppressed for this tab. In the `deptViews` template
      literal, wrap the utilization block:

        ${k!=='mines' ? `<div class="sec"> ...utilization section... </div>` : ''}

      `util` below is an empty array. Do not populate it with estimates.
   ==========================================================================*/

  mines:{
    key:'mines', label:'Mines', swatch:'#0E6E6E', hero:'h-mines',
    eyebrow:'Mines Operations Digitization', title:'Kaliapani Mines Operational Dashboard',
    lede:'16 tracked modules on a single in-house platform — 10 live covering production, excavation, beneficiation, equipment, dewatering and fuel, plus an agentic AI insights layer and a pre-generated 07:00 digest for the daily management review. The OEE/LCM engine is in progress; Electric Vehicles Tracking, Mines Costing and AMIRA Accounting are yet to start.',
    live:10, prog:3, plan:3, hold:0, total:16,

    kpis:[
      ['16','k-accent','<b>Modules</b> in the mines suite'],
      ['10','k-green','<b>Live</b> in production'],
      ['3','k-amber','<b>In progress</b>'],
      ['3','k-slate','<b>To do</b> — not yet started'],
      ['63%','k-steel','<b>Implemented</b>'],
    ],

    cards:[['Kaliapani Mines Operational Dashboard',10,3,3,0,16,
      [['Live modules','10 of 16'],['Core users','GM Mines, Plant Head, Shift In-charge'],['Critical blockers','EV vendor API · 2 modules unscoped']],
      'OEE/LCM in progress; Mines Costing &amp; AMIRA Accounting await scope from Finance.']],

    util:[],

    value:[
      ['MIS Dashboard — 9 sections','Live',
       'Replaces the manual shift &amp; MTD Excel MIS; 9 operating domains in one scroll; one-click full-dashboard HTML export for circulation.',
       'Plan-vs-actual with achieve % and variance across ore, OB, COB, despatch and dewatering; date / month / financial-year filters on every KPI.',
       'Built in-house — no licence or per-seat cost. Rupee benefit not yet quantified.'],
      ['AI Insights &amp; Reality Check','Live',
       'LLM narrative across 6 domains replaces manual review notes; digest pre-generated at 07:00 so the 08:00 review opens instantly.',
       'Run-rate vs required-rate per KPI flagged ACHIEVABLE / STRETCH / NOT FEASIBLE; exception alerting, 7-day trend, today-vs-yesterday.',
       'Runs on the internal LiteLLM gateway — API cost only, no external AI licence. Breakdown hours converted to lost-ore MT for cost context.'],
      ['Equipment Utilization','Live',
       'MTTR / MTBF, breakdown drill-down and fuel LPH per machine on demand — no manual breakdown register.',
       'Excavator and tipper availability &amp; utilisation from SAP PM notification durations, with per-machine trend charts.',
       'Breakdown-hour visibility enables targeted maintenance; rupee benefit to be measured.'],
      ['Fuel Management (Phase 1)','Live',
       'Fleet fuel level, refill and drain events and a 7-day consumption trend straight from telematics — replaces manual fuel registers.',
       'Per-vehicle LPH, tank level, estimated hours remaining and low-fuel banding across the fleet.',
       'Drain / pilferage detection live; quantified saving arrives with Phase 3 costing.'],
      ['OEE / LCM Engine','Prog',
       'Per-excavator OEE derived automatically from 3 source tables — removes the manual availability / performance computation entirely. Computing today; not yet certified for review use.',
       '5 excavators tracked with a full God-hour to operating-hour loss waterfall (weekly off, no-plan, planned shutdown, breakdown, PM).',
       'Value pending — figures cannot be relied on until the SAP PM time columns land and the loss-hour fields are populated.'],
      ['Electric Vehicles Tracking','Plan',
       'On delivery: EV operating, idling and working hours plus energy consumed per vehicle in a single view.',
       'On delivery: kWh/hr efficiency, battery state-of-charge and state-of-health per EV.',
       'Not yet realisable — the EV vehicle API has not been released by the vendor, so no EV data is flowing.'],
      ['Mines Costing','Plan',
       'On delivery: cost-centre-wise mining cost without manual compilation from SAP reports.',
       'On delivery: cost per tonne of ore and per CuM of overburden tracked against budget — the missing commercial layer over the existing production volumes.',
       'Directly enables cost control at the mining face. Scope and methodology to be agreed with Finance &amp; Accounts.'],
      ['AMIRA Accounting','Plan',
       'Scope to be defined with Finance &amp; Accounts.',
       'Scope to be defined with Finance &amp; Accounts.',
       'Cannot be assessed — no source system or expected output identified yet.'],
    ],

    status:[
      {p:'OEE / LCM',st:'prog',due:null,dueTxt:'On SAP delivery',
       owner:'IT &amp; Digitization · SAP CoE · Mines operations',
       rmk:'Engine is built and computing per-excavator OEE across all 5 excavators. Two dependencies keep it in progress: preventive-maintenance duration is date-level only until SAP adds the start and completion time columns, and the excavator loss-hour fields are still blank, which overstates availability. Both must close before the figures can be used in review.'},
      {p:'Electric Vehicles Tracking',st:'plan',due:null,dueTxt:'On vendor delivery',
       owner:'EV vendor — vehicle API',
       rmk:'Held before start. The EV vehicle API has not been released by the vendor, so no EV data is available to build against. No internal effort is outstanding — this is entirely vendor-gated.'},
      {p:'Fuel Phase 2 — exception e-mail alerts',st:'prog',due:null,dueTxt:'No fixed date',
       owner:'IT &amp; Digitization · Mines Mech',
       rmk:'Low-fuel and drain-event alerting to the mines mechanical desk.'},
      {p:'Fuel Phase 3 — cost, drain &amp; countdown',st:'prog',due:null,dueTxt:'No fixed date',
       owner:'IT &amp; Digitization · Stores rates',
       rmk:'Converts litres to rupees and adds refill countdown. Required to value fuel-pilferage prevention.'},
      {p:'Mines Costing',st:'plan',due:null,dueTxt:'Scope pending',
       owner:'Finance &amp; Accounts · IT &amp; Digitization',
       rmk:'Not started. Cost-centre-wise mining cost with cost per tonne of ore and per CuM of overburden against budget. The SAP cost-centre master already carries 15 mines cost centres, so the master data exists — costing methodology and reporting format need to be agreed with Finance before build.'},
      {p:'AMIRA Accounting',st:'plan',due:null,dueTxt:'Scope pending',
       owner:'Finance &amp; Accounts · IT &amp; Digitization',
       rmk:'Not started. No source system or existing data set has been identified for this module — scope, source and expected output all need to be defined with Finance &amp; Accounts before it can be estimated or scheduled.'},
    ],

    blockers:[
      {t:'EV vehicle API not released',chip:'hold',
       meta:'Vendor has not delivered the EV vehicle API, so Electric Vehicles Tracking cannot start. Entirely vendor-gated — needs commercial escalation, not development.'},
      {t:'SAP PM time columns pending',chip:'prog',
       meta:'Preventive-maintenance duration is date-level only. SAP CoE is adding start and completion time columns; until then OEE PM hours are approximate.'},
      {t:'Excavator loss-hour fields blank',chip:'prog',
       meta:'Weekly-off, no-plan and planned-shutdown fields are newly added and not being filled, which overstates OEE availability. Operations discipline, not development.'},
      {t:'Two new modules have no scope',chip:'plan',
       meta:'Mines Costing and AMIRA Accounting are approved in principle but undefined. AMIRA in particular has no identified source system. Neither can be estimated or scheduled until Finance &amp; Accounts confirms scope.'},
      {t:'Vehicle ID mismatch',chip:'hold',
       meta:'Telematics device IDs do not match physical registration numbers, so vehicle names display inconsistently in Fuel Management. Mapping sheet required from mines mechanical.'},
    ],

    due:[
      {t:'OEE / LCM',tag:'SAP-gated',cls:'c-prog',
       meta:'Cannot be dated until SAP confirms delivery of the PM time columns and the loss-hour fields are being populated.'},
      {t:'Electric Vehicles Tracking',tag:'Vendor-gated',cls:'c-plan',
       meta:'No date can be committed until the vendor releases the EV vehicle API.'},
      {t:'Fuel Phase 2 &amp; Phase 3',tag:'No date set',cls:'c-prog',
       meta:'Sequenced after Phase 1; dates to be committed.'},
      {t:'Mines Costing &amp; AMIRA Accounting',tag:'Scope pending',cls:'c-plan',
       meta:'Cannot be dated until scope is agreed with Finance &amp; Accounts. Mines Costing is the more advanced of the two — its SAP master data already exists.'},
    ],

    fund:[
      {t:'Built in-house &amp; owned',amt:'No licences',
       meta:'All 16 initiatives developed internally — no per-user licence, full data ownership.'},
      {t:'AI layer run cost',amt:'API cost only',
       meta:'AI Insights and the 07:00 digest run on the internal LiteLLM gateway — no external AI subscription.'},
      {t:'Rupee benefit',amt:'To be measured',
       meta:'Value from production visibility, breakdown reduction, fuel-pilferage prevention and OEE improvement is not yet quantified. Fuel Phase 3 costing and the Mines Costing module are the two steps that will establish a rupee baseline.'},
      {t:'EV transition value',amt:'Blocked',
       meta:'The diesel-vs-EV cost comparison cannot be built until the vendor API delivers EV hours and energy data. Direct commercial relevance once unblocked.'},
    ],

    actions:[
      {t:'Escalate the EV vendor API',
       meta:'Highest priority and fully external. Commercial follow-up with the vendor is the only path to starting Electric Vehicles Tracking.'},
      {t:'Close the SAP PM time-column dependency',
       meta:'Chase SAP CoE for the start and completion time columns so OEE preventive-maintenance hours become exact.'},
      {t:'Enforce loss-hour data entry',
       meta:'Brief shift in-charges to fill the weekly-off, no-plan and shutdown fields so OEE availability becomes trustworthy and the module can move to live.'},
      {t:'Complete Fuel Phase 2 and Phase 3',
       meta:'Ship exception alerting to the mechanical desk, then the costing layer that converts litres to rupees.'},
      {t:'Define scope for the two new modules',
       meta:'Sit with Finance &amp; Accounts to fix the costing methodology for Mines Costing and to establish what AMIRA Accounting is required to produce and from which source. Without this neither can be estimated.'},
      {t:'Obtain the vehicle ID mapping sheet',
       meta:'Required from mines mechanical to correct vehicle naming in Fuel Management.'},
      {t:'Quantify the rupee benefit',
       meta:'Fuel Phase 3 costing plus the Mines Costing module will convert the current qualitative value into measured figures for the next review.'},
    ],
  },
