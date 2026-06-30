# CROSSCURRENT RACING PLATFORM
## Full Engineering Specification & Claude Code Build Document (v1.0)

--- 

## 1. INTRODUCTION

### 1.1 Purpose
CrossCurrent Racing is a motorsport engineering decision-support platform designed to determine optimal car-to-track combinations using structured lap data, setup files, and driver feedback.

It does NOT execute race strategy or live telemetry analysis. It is strictly a pre-race engineering intelligence system.

### 1.2 Core Objective
To provide a data-driven, explainable ranking of cars per track layout based on:
- Driver lap performance
- Setup configurations (.svm files)
- Session quality and reliability
- Driver trust weighting
- Benchmark comparison data (external reference)

### 1.3 Key Principle
The system does not guess. It calculates, weights, and explains.

All outputs must be deterministic, explainable, and traceable.

---

## 2. SYSTEM OVERVIEW

### Architecture
Frontend (Next.js)
→ Backend API
→ PostgreSQL
→ Scoring Engine
→ Recommendation Engine
→ JSON Output Layer

### System Separation
Standalone system (NOT race strategy execution).

### Authentication
Discord OAuth only (RBAC via Discord roles).

---

## 3. USER ROLES

Driver: upload data only  
Engineer: analysis + interpretation  
Admin: overrides + trust control  

---

## 4. DATA MODEL

### Drivers
- id, discord_id, name, role
- safety_rating
- performance_rating
- trust_score (admin only)

### Cars
- id, name, category

### Tracks
- id, name, layout_id

### Sessions
- id, driver_id, car_id, track_id
- lmu_patch_version
- lap_count, avg_lap_time, best_lap_time
- off_track_count
- condition_reported
- session_value_score
- data_reliability_score

### Setups
- id, session_id, car_id, track_id
- svm_raw_data
- tc, abs, brake_bias

### Recommendations
- id, track_id, layout_id
- profile_type
- output_json
- confidence_score

---

## 5. SESSION RULES

Valid session:
- min 10 laps
- lap data required
- condition required
- setup optional but weighted

Soft rejection:
- invalid data stored but excluded from scoring

---

## 6. SCORING ENGINE

Car Score:
Race Pace 35%
Consistency 25%
Tyre 15%
Drivability 15%
Mistakes 10%

Session Value Score:
Completeness 30%
Consistency 25%
Cleanliness 20%
Representativeness 15%
Recency 10%

---

## 7. DRIVER TRUST SYSTEM

Hidden admin-only score affecting weighting of contributions.

---

## 8. DATA PRIORITY

1 Admin verified
2 System detected
3 Driver reported
4 Benchmark inference

---

## 9. SETUP MODEL

Car + Track + Session linked .SVM parsing

---

## 10. RECOMMENDATION OUTPUT

JSON structured output with:
- score
- confidence
- evidence
- metadata

---

## 11. PATCH VERSIONING

All sessions tied to LMU version with decay weighting.

---

## 12. ADMIN SYSTEM

2 admins only
Overrides logged and visible.

---

## 13. FRONTEND

Public: login only  
Private: dashboards + analysis  
Admin: control panel  

---

## 14. MVP BUILD ORDER

1 Auth
2 DB
3 Sessions
4 Setup parser
5 Scoring engine
6 Trust system
7 Recommendations
8 Admin tools

---

## 15. FINAL PRINCIPLE

Deterministic, explainable, auditable system only.
