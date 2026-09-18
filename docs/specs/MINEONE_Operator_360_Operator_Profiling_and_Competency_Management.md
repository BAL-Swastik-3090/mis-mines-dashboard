# MINEONE Operator 360° — Operator Profiling & Competency Management
## Kaliapani Mines | Implementation-Ready Functional & Data Model
**Prepared:** 17 Sep 2026

## 1. Objective

The Operator Registry should become an **Operator 360° Profile**, not merely a driver list or licence register.

It should answer:

- Who is the person?
- What education, literacy and language capabilities do they have?
- How many years of total, mining, HEMM and machine-specific experience do they have?
- Which licences, medical fitness records, certificates and authorisations are valid?
- What training and specialised training have they completed?
- What machines can they operate?
- How well do they understand each machine?
- Which competencies have been practically assessed?
- Which machines are they officially assigned to?
- Which machines have they actually operated?
- What is their HRMS attendance/deployment context?
- What safety/performance observations exist?
- What training should HR/Mines arrange next?
- Are they currently eligible for a particular machine and role?

**Employment type (BAL / contractor / trainee / other) is only an attribute, not the centre of the model.**

---

# 2. Operator 360° Structure

Every operator should have separate, structured sections/entities:

1. Personal Information
2. Identification
3. Education
4. Literacy
5. Language Proficiency
6. Work Experience
7. Employment
8. Licence
9. Medical Fitness
10. Training History
11. Specialized Training
12. Certificates & Qualifications
13. Skill & Competency
14. Machine Understanding
15. Machine Eligibility
16. Machine Assignment
17. Actual Operation History
18. HRMS & Attendance
19. Safety Profile
20. Performance Profile
21. Documents
22. Alerts & Compliance
23. Training Needs & Development

---

# 3. Personal Information

Fields:

- Operator ID
- Full Name
- Photo
- Date of Birth
- Gender
- Blood Group
- Mobile
- Alternate Contact
- Emergency Contact / Relationship
- Current Address
- Permanent Address
- Profile Status: Active / Inactive / Suspended / Retired

---

# 4. Identification Information

Keep external identities separate and map them to one `party_id`.

Fields:

- SAP Employee ID
- HRMS ID
- Existing Driver Code
- Contractor Employee ID
- Gate Pass ID
- Biometric ID
- RFID ID
- Other System ID

---

# 5. Education

Education must be separate from literacy.

Fields:

- Highest Qualification
- Qualification Type
- Institution
- Board / University
- Year of Passing
- Grade / Percentage
- Certificate Reference
- Document
- Verification Status
- Verified By / Date

Examples:

- No Formal Schooling
- Primary
- Secondary
- Higher Secondary
- ITI
- Diploma
- Graduate
- Other Technical Qualification

---

# 6. Literacy Profile

Capture independently:

| Capability | Level |
|---|---|
| Reading | Cannot Read / Basic / Functional / Good |
| Writing | Cannot Write / Basic / Functional / Good |
| Numerical Ability | Basic / Functional / Good |
| Digital Literacy | Basic / Functional / Good / Advanced |
| Safety Sign Literacy | Basic / Functional / Good |
| Form / Record Understanding | Basic / Functional / Good |

This helps HR determine appropriate training and communication methods.

---

# 7. Language Proficiency

Use a repeatable language table.

| Language | Understand | Speak | Read | Write | Overall |
|---|---|---|---|---|---|
| Hindi | Level | Level | Level | Level | Level |
| Odia | Level | Level | Level | Level | Level |
| English | Level | Level | Level | Level | Level |
| Other | Level | Level | Level | Level | Level |

Language information should support safety communication, toolbox talks, SOPs, training delivery and emergency communication.

---

# 8. Work Experience

Experience must be a dedicated section and should not be inferred only from current employment.

## 8.1 Summary

- Total Work Experience — years/months
- Total Mining Experience — years/months
- Total HEMM Experience — years/months
- Total Operator Experience — years/months
- Experience at Kaliapani — years/months
- Current Role Experience — years/months

Maintain both **Declared Experience** and **Verified Experience** where possible.

## 8.2 Previous Experience

Repeatable records:

- Employer / Organization
- Mine / Site
- Role
- Equipment Type
- Equipment Model
- Start Date
- End Date
- Years / Months
- Nature of Work
- Verification Status
- Supporting Document
- Remarks

## 8.3 Machine-Specific Experience

Track:

- Machine
- Model
- Experience Years
- Experience Hours
- Last Operated Date
- Verified Status

Actual operating hours should progressively come from trusted MINEONE/telematics/HOTO records.

---

# 9. Employment

Employment is a separate section.

Fields:

- Employment Type
- Employer / Agency
- Department
- Designation
- Role
- Joining Date
- Employment Start / End
- Supervisor
- Work Location
- Shift Pattern
- Status

Maintain employment history.

---

# 10. Licence

Dedicated statutory record:

- Licence Type
- Licence Number
- Licence Class
- Issuing Authority
- Issue Date
- Valid Until
- Applicable Vehicle / Equipment
- Document
- Verification Status
- Verified By / Date

Derived status:

- Valid
- Expiring Soon
- Expired
- Missing
- Verification Pending

---

# 11. Medical Fitness

Separate from licence and training.

Fields:

- Medical Fitness Type
- Examination Date
- Valid From
- Valid Until
- Fitness Status
- Restrictions
- Examining Authority / Doctor
- Certificate
- Verification Status

---

# 12. Training History

Training is not the same as competency.

Each training event should contain:

- Training Name
- Category: Safety / Equipment / Technical / Other
- Provider
- Trainer
- Start Date
- End Date
- Duration
- Result
- Score
- Certificate
- Valid Until
- Refresher Due

---

# 13. Specialized Training

Separate machine/specialized training records.

Examples:

- Excavator operation
- Dumper operation
- Loader operation
- Dozer operation
- Drill operation
- Specialized HEMM
- Emergency response
- Defensive operation
- Fuel handling
- Dewatering equipment
- Mine-specific SOP
- New machine induction

Link each record to:

**Training → Machine → Level → Assessment → Result → Refresh Due → Competency Impact**

---

# 14. Certificates & Qualifications

Certificate register should include:

- Driving Licence
- Operator Certificate
- Vocational Certificate
- ITI Certificate
- Machine Training Certificate
- Safety Certificate
- First Aid Certificate
- Specialized Training Certificate
- Medical Certificate
- Internal Authorization
- Other Certification

For every certificate:

- Certificate Number
- Issuing Authority
- Issue Date
- Expiry Date
- Attachment
- Verification Status
- Verifier
- Verification Date

---

# 15. Skill & Competency

Training does not automatically equal competency.

Competency represents verified capability.

| Field | Description |
|---|---|
| Competency | Skill/capability |
| Machine Type | Applicable equipment |
| Machine Model | Optional |
| Level | Configurable 0–4 |
| Assessment Type | Practical / Written / Observation |
| Assessor | Authorized assessor |
| Assessment Date | Date |
| Score | Assessment score |
| Result | Pass / Fail / Pending |
| Valid Until | If applicable |
| Remarks | Assessment notes |

Suggested levels:

- Level 0 — Not Assessed
- Level 1 — Basic / Assisted
- Level 2 — Operational
- Level 3 — Competent / Independent
- Level 4 — Advanced / Trainer

---

# 16. Machine Understanding

This is a key part of Operator 360°.

The system must distinguish **“has operated a machine”** from **“understands the machine.”**

For each machine:

| Capability | Assessment |
|---|---|
| Machine Familiarity | Level |
| Controls Understanding | Level |
| Operating Procedure | Level |
| Pre-Start Inspection | Level |
| Safety Systems | Level |
| Emergency Shutdown | Level |
| Rated Capacity Understanding | Level |
| Operating Limits | Level |
| Attachment Understanding | Level |
| Fuel / Fluid Checks | Level |
| Basic Fault Recognition | Level |
| Display / Telematics Understanding | Level |
| Safe Parking / Shutdown | Level |
| Mine-Specific SOP Understanding | Level |

Evidence can include:

- training
- practical assessment
- machine hours
- recent operation
- supervisor assessment
- safety observations
- machine-specific experience

Do not store only a final score; retain the underlying evidence.

---

# 17. Machine Eligibility

The system should answer:

> **Can this operator currently be assigned to this machine?**

Check:

1. Required licence
2. Medical fitness
3. Required training
4. Required competency
5. Internal authorization
6. Machine-specific training
7. Experience requirement
8. Refresher status
9. Restrictions/suspension
10. Other configured requirements

Derived status:

- Eligible
- Eligible with Restriction
- Training Required
- Assessment Required
- Document Expired
- Medical Expired
- Licence Expired
- Not Authorized
- Suspended
- Not Assessed

Eligibility must be derived from documented requirements.

---

# 18. Machine Assignment

Assignment answers:

> Which machine is the operator officially assigned to?

Fields:

- Operator
- Machine / Asset
- Shift
- Role
- Primary / Secondary / Reliever
- Effective From
- Effective To
- Assigned By
- Approved By
- Status

**Competency ≠ Assignment.**

A person can be competent for a machine without currently being assigned to it.

---

# 19. Actual Operation History

Actual operation answers:

> Which machine did the operator actually operate?

Potential sources:

- HOTO
- Telematics
- RFID
- Deployment
- Shift records
- Operator login

Capture:

- Operator
- Machine
- Shift
- Date
- Start Time
- End Time
- Operating Hours
- Source
- Verification / Confidence

This creates the important chain:

**Authorized → Assigned → Actually Operated**

---

# 20. HRMS & Attendance

Keep HRMS attendance as a separate domain.

Integrate:

- Attendance status
- Shift attendance
- Absence
- Late attendance
- Leave
- Overtime
- Employment status
- Training attendance

Do not duplicate HRMS master data unnecessarily.

---

# 21. Safety Profile

Structured records:

- Safety Induction
- Toolbox Participation
- Safety Training
- Near Miss
- Incident
- Safety Observation
- Violation
- Recognition
- Corrective Action
- Safety Assessment

Keep:

**Incident ≠ Observation ≠ Training ≠ Competency**

---

# 22. Performance Profile

Where reliable data exists, show contextual indicators:

- Operating Hours
- Productive Hours
- Idle Hours
- Fuel Efficiency
- Cycle Performance
- Equipment Utilization
- Safety Observations
- Attendance
- Production Contribution

Always consider machine, shift, material and operating conditions.

Avoid using raw metrics as standalone operator rankings.

---

# 23. Training Need Analysis

The most important HR output is a structured **Training Gap**.

Examples:

| Gap | System Action |
|---|---|
| Licence expiring | Renewal requirement |
| Machine training missing | Arrange training |
| Competency not assessed | Practical assessment |
| Weak machine understanding | Machine refresher |
| No recent operation | Re-familiarization |
| Safety refresher due | Schedule refresher |
| First aid missing | Nominate for training |
| Digital literacy gap | Digital training |
| Experience below requirement | Supervised operation |
| New equipment introduced | New machine induction |

---

# 24. HR Training Dashboard

KPIs:

- Total Operators
- Fully Profiled
- Missing Documents
- Expired Documents
- Training Due
- Training Overdue
- Competency Assessment Due
- Machine-Specific Gaps
- Operators Not Eligible for Assigned Machine
- Refresher Required
- Skill Upgrade Candidates
- New Operators Requiring Induction

HR should be able to convert:

**Gap → Training Requirement → Training Plan → Nomination → Attendance → Assessment → Competency Update → Gap Closed**

---

# 25. Operator Capability Matrix

Mine-wide capability matrix:

| Operator | Excavator | Dumper | Loader | Dozer | Drill |
|---|---:|---:|---:|---:|---:|
| Operator A | L3 | L2 | L0 | L0 | L0 |
| Operator B | L0 | L3 | L2 | L1 | L0 |
| Operator C | L4 | L3 | L3 | L2 | L1 |

Add indicators for:

- Licence validity
- Medical validity
- Training validity
- Assessment validity
- Recent operation
- Machine hours
- Readiness
- Training gap

This becomes the **Mine Workforce Capability Map**.

---

# 26. Operator 360° Screen

Header:

- Photo
- Name
- Operator ID
- Current Role
- Current Machine
- Status
- Profile Completeness
- Eligibility Status

Separate tabs/sections:

1. Personal
2. Identification
3. Education
4. Literacy
5. Languages
6. Experience
7. Employment
8. Licence
9. Medical
10. Training
11. Specialized Training
12. Certificates
13. Competency
14. Machine Understanding
15. Eligibility
16. Assignment
17. Actual Operation
18. HRMS
19. Safety
20. Documents
21. Alerts
22. Training Needs

Each section should show:

- Complete / Incomplete
- Verified / Unverified
- Expiring / Expired
- Last Updated
- Data Owner

---

# 27. Profile Completeness

Do not make every field mandatory.

Classify fields as:

- Mandatory
- Conditionally Mandatory
- Optional
- Not Applicable

Completeness should cover:

Personal → Identification → Education → Literacy → Language → Experience → Employment → Licence → Medical → Training → Competency → Documents.

---

# 28. Data Model

Use the existing `party` model as the person foundation.

### Core

- `party`
- `party_identity`
- `party_employment`

### Operator Profile

- `operator_education`
- `operator_literacy`
- `operator_language`
- `operator_experience`
- `operator_machine_experience`
- `operator_license`
- `operator_medical`
- `operator_training`
- `operator_specialized_training`
- `operator_certificate`
- `operator_competency`
- `operator_machine_understanding`
- `operator_assignment`
- `operator_operation_history`
- `operator_safety_record`
- `operator_training_gap`
- `operator_alert`

Do not create another operator/person master.

---

# 29. Source-of-Truth

| Information | Source |
|---|---|
| Person master | MINEONE `party` |
| SAP ID | SAP |
| HRMS ID / Attendance | HRMS |
| Employment | HRMS / MINEONE |
| Machine master | MINEONE `asset` |
| Licence | Verified operator records |
| Medical | Authorized medical record |
| Training | Training/L&D |
| Competency | Authorized assessment |
| Machine Understanding | Assessment |
| Official Assignment | MINEONE |
| Actual Operation | HOTO / telematics / deployment |
| Machine Hours | Telematics / asset data |
| Safety | Safety system / MINEONE |
| Training Gaps | MINEONE derived intelligence |

---

# 30. Existing Mine Data Integration

## `mines_driver_master`

Use as a source for:

- driver/operator identity
- driver code
- name
- existing machine association

Do not automatically treat `Equipment_Type` as the definitive equipment-type master until verified.

The existing Operator Registry plan identified 133 records, blank licence/validity fields, and unmatched SAP codes. These should go into a **verification/unregistered queue**, not be silently discarded.

## HOTO

Use HOTO as evidence of actual operation:

`party → operator → asset → shift → HOTO`

## Tipper Downtime

The existing `absence_operator` reason should eventually be linked to named operator/deployment data where evidence exists.

## Agency Master

Agency/employer remains an employment attribute.

---

# 31. Workflow

## Registration

`New Person → Identity Verification → Profile Creation → Documents → Employment → Education/Literacy/Language → Experience → Licence/Medical → Training → Competency → Machine Understanding → Approval → Active`

## Training

`Gap Identified → HR Review → Training Requirement → Training Scheduled → Nomination → Training Completed → Assessment → Competency Updated → Gap Closed`

## Machine Eligibility

`Machine Selected → Requirements Evaluated → Operator Profile Checked → Eligibility Result → Assignment Approval → Deployment`

---

# 32. Permissions & Audit

Recommended permissions:

- `platform.operators.view`
- `platform.operators.manage`
- `platform.operators.submit`
- `platform.operators.verify`
- `platform.operators.approve`
- `platform.operators.assess`
- `platform.operators.training`

Possible roles:

- Operator Registrar
- Operator Verifier
- Competency Assessor
- Operator Register Approver
- HR / Training Manager
- Mine Operations Manager
- Safety Reviewer
- System Administrator

Every important change should retain:

- Created By / At
- Updated By / At
- Submitted By / At
- Approved By / At
- Revision
- Previous Value
- New Value

---

# 33. Alerts

### Statutory
- Licence expiry
- Medical expiry
- Certificate expiry

### Training
- Training due
- Refresher due
- Competency assessment due
- Specialized training expiry

### Machine
- Machine authorization gap
- Machine-specific training gap
- No recent operation

### Profile
- Missing mandatory information
- Unverified document
- Unmatched identity

---

# 34. Search & Intelligence

Users should be able to query:

- Operators for a specific machine
- Operators with >X years HEMM experience
- Operators with specific machine hours
- Operators whose licence expires within X days
- Operators requiring refresher training
- Operators with no competency assessment
- Operators who have not operated a machine recently
- Operators proficient in Hindi/Odia/English
- Operators with specific certificates
- Multi-skilled operators
- Operators eligible for a specific shift/machine
- Operators with missing profile sections

---

# 35. Advanced Operator Intelligence

The future Operator 360° layer can support:

### Capability
What can the operator do?

### Experience
How much verified experience exists?

### Machine Knowledge
How well does the operator understand each machine?

### Compliance
Are licence, medical and certificates current?

### Actual Exposure
How much has the operator actually operated the machine?

### Safety
What safety learning/observations exist?

### Development
What skill gap should be addressed?

### Workforce Planning
Where are capability shortages and multi-skilled capacity?

The system should provide evidence for management decisions rather than automatically making HR decisions.

---

# 36. Implementation Phases

## Phase 1 — Foundation
- party / identity / employment
- Operator Registry
- Personal
- Identification
- Employment
- Permissions

## Phase 2 — Complete Profile
- Education
- Literacy
- Language
- Experience
- Documents
- Completeness

## Phase 3 — Compliance
- Licence
- Medical
- Certificates
- Alerts

## Phase 4 — Capability
- Training
- Specialized Training
- Competency
- Machine Understanding
- Assessments

## Phase 5 — Machine Intelligence
- Machine eligibility
- Assignment
- Actual operation
- HOTO integration
- Telematics integration
- Capability matrix

## Phase 6 — HR Intelligence
- Training gap engine
- Training recommendations
- HR dashboard
- Capability map
- Skill development

## Phase 7 — Advanced Analytics
- Capability analytics
- Training effectiveness
- Safety/capability correlation
- Workforce planning
- AI-assisted training recommendations

---

# 37. Non-Negotiable Design Rules

1. Do not build a simple driver master.
2. Do not make BAL vs contractor the primary structure.
3. Employment type is only an attribute.
4. Education ≠ Literacy.
5. Experience ≠ Employment.
6. Training ≠ Competency.
7. Certificate ≠ Authorization.
8. Assignment ≠ Actual Operation.
9. HRMS Attendance ≠ MINEONE Deployment.
10. Machine operation ≠ Machine understanding.
11. Eligibility must be derived from documented requirements.
12. Retain the evidence behind every competency/readiness result.
13. Missing information must remain visible.
14. Training recommendations must be explainable from identified gaps.
15. HR must be able to convert gaps into training plans.
16. All statutory/personal data must use role-based access.
17. All approvals and verification must be auditable.
18. Actual operating history should progressively use trusted machine/HOTO data.
19. The model must support own, contractor and future workforce categories without changing the core person model.
20. The model must support future underground operations and new equipment types.

---

# 38. Target State

The final system should transform:

**Driver List → Operator Registry → Operator 360° → Workforce Capability Intelligence**

For every operator, MINEONE should continuously show:

**Who they are → What they know → What they can do → What they are trained for → What they are certified for → What machines they understand → What machines they are authorized to operate → What machines they actually operate → What compliance gaps exist → What training HR should arrange → Whether they are currently ready for deployment.**

This makes the Operator Registry a strategic foundation for **safer deployment, competency management, training planning, workforce capability visibility, skill development, compliance management and future AI-driven workforce planning.**
