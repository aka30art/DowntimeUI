const id = () => globalThis.crypto?.randomUUID?.() || ("id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12));
const rows = (tables, name) => (tables[name] ||= []);
const dateLondon = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const actorName = (value) => String(value || "SYSTEM").trim().slice(0, 80) || "SYSTEM";
const cleanText = (value, max = 120) => String(value ?? "").trim().slice(0, max);

function audit(tables, { visitId = null, actor = "SYSTEM", action, details = {} }, now) {
  rows(tables, "gatelog_audit").push({
    id: id(), visit_id: visitId, actor: actorName(actor), action,
    details, created_at: now().toISOString()
  });
}

function wasteIds(tables, visitId, labels, now) {
  const links = rows(tables, "gatelog_visit_waste_types");
  const waste = rows(tables, "gatelog_waste_types");
  const unique = [...new Set((Array.isArray(labels) ? labels : []).map(x => cleanText(x, 80)).filter(Boolean))];
  if (!unique.length) throw new Error("Select at least one waste type");
  if (unique.length > 12) throw new Error("A visit can contain up to 12 waste types");
  for (const label of unique) {
    let type = waste.find(x => String(x.label).toLowerCase() === label.toLowerCase());
    if (!type) {
      type = { id: id(), label, active: true, created_at: now().toISOString() };
      waste.push(type);
    } else type.active = true;
    if (!links.some(x => x.visit_id === visitId && x.waste_type_id === type.id)) {
      links.push({ visit_id: visitId, waste_type_id: type.id });
    }
  }
  return unique;
}

function wasteLabels(tables, visitId) {
  const links = rows(tables, "gatelog_visit_waste_types").filter(x => x.visit_id === visitId);
  const waste = rows(tables, "gatelog_waste_types");
  return links.map(link => waste.find(x => x.id === link.waste_type_id)?.label).filter(Boolean).sort();
}

function findOrCreateVehicle(tables, customerId, registration, now) {
  const list = rows(tables, "gatelog_vehicles");
  let vehicle = list.find(x => x.customer_id === customerId && String(x.registration).toUpperCase() === registration);
  if (vehicle) { vehicle.active = true; vehicle.updated_at = now().toISOString(); return vehicle; }
  vehicle = { id: id(), customer_id: customerId, registration, active: true, created_at: now().toISOString() };
  list.push(vehicle);
  return vehicle;
}

function createVisit(tables, customerId, registration, wasteTypes, actor, now) {
  const customer = rows(tables, "gatelog_customers").find(x => x.id === customerId && x.active !== false);
  if (!customer) throw new Error("Selected customer is unavailable");
  const reg = cleanText(registration, 20).toUpperCase();
  if (!reg) throw new Error("A valid vehicle registration is required");
  const vehicle = findOrCreateVehicle(tables, customerId, reg, now);
  const timestamp = now().toISOString();
  const visit = {
    id: id(), customer_id: customerId, vehicle_id: vehicle.id,
    vehicle_registration_snapshot: reg, visit_date: dateLondon(now()),
    time_in: timestamp, time_out: null, status: "ON_SITE",
    created_by: actorName(actor), departed_by: null, created_at: timestamp
  };
  rows(tables, "gatelog_visits").push(visit);
  wasteIds(tables, visit.id, wasteTypes, now);
  audit(tables, { visitId: visit.id, actor, action: "ARRIVAL", details: { registration: reg, wasteTypes } }, now);
  return visit;
}

function commonWaste(tables, visits) {
  const counts = new Map();
  for (const visit of visits) {
    for (const label of wasteLabels(tables, visit.id)) counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "—";
}

function minutesBetween(start, end) {
  if (!start || !end) return null;
  const a = Date.parse(start), b = Date.parse(end);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? (b - a) / 60000 : null;
}

function dateAdd(value, days) {
  const date = new Date(String(value) + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function periodStats(tables, today) {
  const current = new Date(String(today) + "T12:00:00Z");
  const mondayOffset = (current.getUTCDay() + 6) % 7;
  const weekStart = dateAdd(today, -mondayOffset);
  const monthStart = today.slice(0, 7) + "-01";
  const monthEndDate = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1));
  const monthEnd = monthEndDate.toISOString().slice(0, 10);
  const visits = rows(tables, "gatelog_visits");
  const ranges = [
    ["daily", today, dateAdd(today, 1)],
    ["weekly", weekStart, dateAdd(weekStart, 7)],
    ["monthly", monthStart, monthEnd],
    ["all_time", null, null]
  ];
  return ranges.map(([period_key, start, end]) => {
    const subset = visits.filter(v => (!start || v.visit_date >= start) && (!end || v.visit_date < end));
    const completed = subset.filter(v => v.status === "DEPARTED" && v.time_out);
    const durations = completed.map(v => minutesBetween(v.time_in, v.time_out)).filter(x => x !== null);
    const average = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
    return {
      period_key, total_visits: subset.length,
      most_common_waste_type: commonWaste(tables, subset),
      average_minutes: average, completed_visits: completed.length
    };
  });
}

function saveCentralBank(tables, args, now, includeStaffEvents = false) {
  const bankRows = rows(tables, "downtime_central_bank");
  const bank = bankRows.find(x => Number(x.id) === 1);
  if (!bank) throw new Error("Central Bank row is missing");
  if (Number(bank.version) !== Number(args.p_expected_version)) return null;
  if (!args.p_payload || typeof args.p_payload !== "object" || Array.isArray(args.p_payload)) throw new Error("Central payload must be an object");
  const timestamp = now().toISOString();
  bank.payload = args.p_payload;
  bank.version = Number(bank.version || 0) + 1;
  bank.updated_at = timestamp;
  rows(tables, "downtime_central_audit").push({
    id: id(), username: actorName(args.p_username || args.p_actor_username),
    action: includeStaffEvents ? "save-settings" : cleanText(args.p_action, 80),
    details: args.p_audit_details || args.p_details || {}, created_at: timestamp
  });
  if (includeStaffEvents) {
    const events = Array.isArray(args.p_staff_audit_events) ? args.p_staff_audit_events : [];
    const allowed = new Set(["staff-created", "staff-archived", "staff-restored", "staff-updated", "staff-roles-updated"]);
    for (const event of events) {
      if (!event || typeof event !== "object" || !allowed.has(event.action)) throw new Error("Staff audit event action is invalid");
      rows(tables, "downtime_central_audit").push({
        id: id(), username: actorName(args.p_username), action: event.action,
        details: event.details && typeof event.details === "object" ? event.details : {}, created_at: timestamp
      });
    }
  }
  return { version: bank.version, updatedAt: timestamp };
}

function ensureDate(value) {
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("A valid ISO date is required");
  return date;
}

export const GITHUB_YARDHUB_RPC_HANDLERS = Object.freeze({
  downtime_get_bootstrap_code() {
    return "YARDHUB-INITIAL-SETUP";
  },

  downtime_central_commit_identity_event({ tables, args, now }) {
    const result = saveCentralBank(tables, {
      p_expected_version: args.p_expected_version,
      p_payload: args.p_payload,
      p_actor_username: args.p_actor_username,
      p_action: args.p_action,
      p_details: args.p_details
    }, now, false);
    if (!result) throw Object.assign(new Error("VERSION_CONFLICT"), { status: 409 });
    return result;
  },

  downtime_commit_central_bank({ tables, args, now }) {
    return saveCentralBank(tables, args, now, true);
  },

  yard_hub_save_tier_settings({ tables, args, now }) {
    const config = rows(tables, "yard_hub_tier_config");
    const current = config.find(x => Number(x.id) === 1);
    if (!current || Number(current.version) !== Number(args.p_expected_version)) return null;
    const previous = structuredClone(current.payload || {});
    current.payload = args.p_next_payload;
    current.version = Number(current.version || 0) + 1;
    current.updated_by = actorName(args.p_actor);
    current.updated_at = now().toISOString();
    rows(tables, "yard_hub_access_audit").push({
      id: id(), actor: actorName(args.p_actor), action: "tier-permissions-save",
      previous_payload: previous, new_payload: args.p_next_payload, created_at: current.updated_at
    });
    return current.version;
  },

  gatelog_create_arrival({ tables, args, now }) {
    const visit = createVisit(tables, args.p_customer_id, args.p_registration, args.p_waste_types, args.p_actor, now);
    return visit.id;
  },

  gatelog_create_customer_arrival({ tables, args, now }) {
    const name = cleanText(args.p_customer_name, 120);
    if (!name) throw new Error("A valid customer/company name is required");
    const customers = rows(tables, "gatelog_customers");
    let customer = customers.find(x => x.active !== false && String(x.customer_name).toLowerCase() === name.toLowerCase());
    const created = !customer;
    if (!customer) {
      customer = { id: id(), customer_name: name, active: true, created_at: now().toISOString() };
      customers.push(customer);
    }
    const visit = createVisit(tables, customer.id, args.p_registration, args.p_waste_types, args.p_actor, now);
    return [{ customer_id: customer.id, customer_name: customer.customer_name, visit_id: visit.id, customer_created: created }];
  },

  gatelog_register_departure({ tables, args, now }) {
    const visit = rows(tables, "gatelog_visits").find(x => x.id === args.p_visit_id && x.status === "ON_SITE");
    if (!visit) return [];
    const timestamp = now().toISOString();
    visit.status = "DEPARTED";
    visit.time_out = timestamp;
    visit.departed_by = actorName(args.p_actor);
    audit(tables, { visitId: visit.id, actor: args.p_actor, action: "DEPARTURE" }, now);
    return [{ id: visit.id, time_out: timestamp, status: visit.status }];
  },

  gatelog_assign_gateman({ tables, args, now }) {
    const dutyDate = ensureDate(args.p_duty_date);
    const list = rows(tables, "gatelog_daily_gateman_assignments");
    let assignment = list.find(x => x.duty_date === dutyDate);
    if (assignment?.is_locked) return [];
    const timestamp = now().toISOString();
    if (!assignment) {
      assignment = { duty_date: dutyDate, assigned_at: timestamp, is_locked: false, locked_by: null, locked_at: null };
      list.push(assignment);
    }
    Object.assign(assignment, {
      gateman_username: cleanText(args.p_gateman_username, 80),
      gateman_name: cleanText(args.p_gateman_name, 80),
      assigned_by: actorName(args.p_actor), assigned_at: timestamp,
      updated_by: actorName(args.p_actor), updated_at: timestamp
    });
    return [assignment];
  },

  gatelog_lock_gateman({ tables, args, now }) {
    const assignment = rows(tables, "gatelog_daily_gateman_assignments").find(x => x.duty_date === ensureDate(args.p_duty_date));
    if (!assignment || assignment.is_locked || !assignment.gateman_username) return [];
    const timestamp = now().toISOString();
    Object.assign(assignment, {
      is_locked: true, locked_by: actorName(args.p_actor), locked_at: timestamp,
      updated_by: actorName(args.p_actor), updated_at: timestamp
    });
    return [assignment];
  },

  gatelog_customer_visit_stats({ tables, now }) {
    const visits = rows(tables, "gatelog_visits");
    const today = dateLondon(now());
    const grouped = new Map();
    for (const visit of visits) {
      const current = grouped.get(visit.customer_id) || { customer_id: visit.customer_id, total_visits: 0, today_visits: 0 };
      current.total_visits += 1;
      if (visit.visit_date === today) current.today_visits += 1;
      grouped.set(visit.customer_id, current);
    }
    return [...grouped.values()];
  },

  gatelog_overall_statistics({ tables }) {
    const visits = rows(tables, "gatelog_visits");
    const completed = visits.filter(x => x.status === "DEPARTED" && x.time_out);
    const durations = completed.map(x => minutesBetween(x.time_in, x.time_out)).filter(x => x !== null);
    return [{
      total_visits: visits.length,
      most_common_waste_type: commonWaste(tables, visits),
      average_minutes: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      completed_visits: completed.length
    }];
  },

  gatelog_period_statistics({ tables, args }) {
    return periodStats(tables, ensureDate(args.p_today));
  },

  gatelog_update_visit({ tables, args, now }) {
    const visit = rows(tables, "gatelog_visits").find(x => x.id === args.p_visit_id);
    if (!visit) throw new Error("Visit not found or already removed");
    const customer = rows(tables, "gatelog_customers").find(x => x.id === args.p_customer_id);
    if (!customer) throw new Error("Selected customer was not found");
    const registration = cleanText(args.p_registration, 20).toUpperCase();
    const visitDate = ensureDate(args.p_visit_date);
    const timeIn = new Date(args.p_time_in), timeOut = args.p_time_out ? new Date(args.p_time_out) : null;
    if (!registration || !Number.isFinite(timeIn.getTime())) throw new Error("Visit date and Time In are required");
    if (dateLondon(timeIn) !== visitDate) throw new Error("Visit date must match the UK date of Time In");
    if (timeOut && (!Number.isFinite(timeOut.getTime()) || timeOut < timeIn)) throw new Error("Time Out cannot be earlier than Time In");
    const before = {
      customer_id: visit.customer_id, registration: visit.vehicle_registration_snapshot,
      visit_date: visit.visit_date, time_in: visit.time_in, time_out: visit.time_out,
      status: visit.status, waste_types: wasteLabels(tables, visit.id)
    };
    const vehicle = findOrCreateVehicle(tables, customer.id, registration, now);
    Object.assign(visit, {
      customer_id: customer.id, vehicle_id: vehicle.id,
      vehicle_registration_snapshot: registration, visit_date: visitDate,
      time_in: timeIn.toISOString(), time_out: timeOut?.toISOString() || null,
      status: timeOut ? "DEPARTED" : "ON_SITE",
      departed_by: timeOut ? actorName(args.p_actor) : null
    });
    rows(tables, "gatelog_visit_waste_types").splice(0, rows(tables, "gatelog_visit_waste_types").length,
      ...rows(tables, "gatelog_visit_waste_types").filter(x => x.visit_id !== visit.id));
    const labels = wasteIds(tables, visit.id, args.p_waste_types, now);
    const after = {
      customer_id: customer.id, customer_name: customer.customer_name,
      registration, visit_date: visitDate, time_in: visit.time_in, time_out: visit.time_out,
      status: visit.status, waste_types: labels
    };
    audit(tables, { visitId: visit.id, actor: args.p_actor, action: "VISIT_UPDATED", details: { before, after } }, now);
    return visit.id;
  },

  gatelog_delete_visit({ tables, args, now }) {
    const visits = rows(tables, "gatelog_visits");
    const index = visits.findIndex(x => x.id === args.p_visit_id);
    if (index < 0) return null;
    const visit = visits[index];
    const customer = rows(tables, "gatelog_customers").find(x => x.id === visit.customer_id);
    const details = {
      visit_id: visit.id, customer_id: visit.customer_id,
      customer_name: customer?.customer_name || "Unknown",
      registration: visit.vehicle_registration_snapshot,
      visit_date: visit.visit_date, time_in: visit.time_in, time_out: visit.time_out,
      status: visit.status, created_by: visit.created_by, departed_by: visit.departed_by,
      waste_types: wasteLabels(tables, visit.id)
    };
    audit(tables, { visitId: visit.id, actor: args.p_actor, action: "VISIT_DELETED", details }, now);
    visits.splice(index, 1);
    rows(tables, "gatelog_visit_waste_types").splice(0, rows(tables, "gatelog_visit_waste_types").length,
      ...rows(tables, "gatelog_visit_waste_types").filter(x => x.visit_id !== visit.id));
    return visit.id;
  }
});
