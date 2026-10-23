// ============================================================
// CONDITION SHEET — shared by Inspector (agent) and Seller (self) flows
// Ratings: G good · F fair (minor) · P poor (needs repair) · NA
// ============================================================
import { escapeHtml } from './shared.js';

export const SHEET = [
    { key: 'docs', title: 'Documents & ownership', critical: true, items: [
        'Logbook matches seller ID', 'Chassis & engine numbers match logbook',
        'NTSA/TIMS search clear (no caveat or lien)', 'Valid insurance & inspection sticker'] },
    { key: 'body', title: 'Exterior & body', items: [
        'Panels & paint (no repaint/filler)', 'Rust or corrosion', 'Glass & lights', 'Doors, locks, mirrors'] },
    { key: 'interior', title: 'Interior', items: [
        'Seats & upholstery', 'Dashboard warning lights', 'A/C & electrics', 'Damp, mould or smell'] },
    { key: 'engine', title: 'Engine bay', items: [
        'Oil & coolant condition', 'Leaks', 'Belts, hoses, battery', 'Signs of engine/gearbox swap'] },
    { key: 'chassis', title: 'Underbody, tyres & brakes', items: [
        'Chassis straight / no weld repairs', 'Suspension', 'Brakes', 'Tyre tread & condition'] },
    { key: 'drive', title: 'Test drive / operation', items: [
        'Starts & idles smoothly', 'Gearbox / clutch / hydraulics', 'Steering & handling', 'Exhaust smoke / abnormal noise'] }
];

const RATINGS = [['', 'Rate…'], ['G', 'G – Good'], ['F', 'F – Fair'], ['P', 'P – Poor'], ['NA', 'N/A']];

export function renderSheet(el, prefix = 'cs') {
    el.innerHTML = SHEET.map(s => `
      <div class="card" style="margin-bottom:12px;">
        <div class="card-title" style="margin-bottom:8px;">${escapeHtml(s.title)}</div>
        ${s.items.map((it, i) => `
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
            <span style="flex:1;font-size:0.85rem;">${escapeHtml(it)}</span>
            <select class="form-select" style="width:120px;" data-cs="${prefix}" data-sec="${s.key}" data-idx="${i}">
              ${RATINGS.map(r => `<option value="${r[0]}">${r[1]}</option>`).join('')}
            </select>
          </div>`).join('')}
      </div>`).join('') + `
      <div class="form-group"><label class="form-label">Accident history</label>
        <select class="form-select" id="${prefix}-accident"><option value="none">None known</option><option value="minor">Minor</option><option value="major">Major</option><option value="unknown">Unknown</option></select></div>
      <div class="form-group"><label class="form-label">Defects & notes</label>
        <textarea class="form-textarea" id="${prefix}-notes" placeholder="List every F/P item and any repairs"></textarea></div>
      <label class="checkbox-line"><input type="checkbox" id="${prefix}-photos"> Required photos captured (4 sides, dashboard, odometer, engine bay, VIN plate, logbook)</label>`;
}

// Returns { report } or { error }
export function readSheet(el, prefix = 'cs') {
    const ratings = {}, defects = [];
    let missing = 0, score = 0, docPoor = false;
    el.querySelectorAll(`select[data-cs="${prefix}"]`).forEach(sel => {
        const sec = SHEET.find(s => s.key === sel.dataset.sec);
        const name = sec.items[+sel.dataset.idx], v = sel.value;
        if (!v) { missing++; return; }
        (ratings[sec.key] = ratings[sec.key] || {})[name] = v;
        if (v === 'F') score += 1;
        if (v === 'P') { score += 3; if (sec.critical) docPoor = true; }
        if (v !== 'G' && v !== 'NA') defects.push(`${sec.title}: ${name} (${v})`);
    });
    if (missing) return { error: `Rate all items (${missing} left).` };
    if (!el.querySelector(`#${prefix}-photos`).checked) return { error: 'Confirm required photos were captured.' };
    const accident = el.querySelector(`#${prefix}-accident`).value;
    if (accident === 'major') score += 6; else if (accident === 'minor') score += 2;
    const grade = docPoor ? 'E' : score <= 1 ? 'A' : score <= 5 ? 'B' : score <= 10 ? 'C' : score <= 16 ? 'D' : 'E';
    return { report: { ratings, defects, accident, notes: el.querySelector(`#${prefix}-notes`).value.trim(), grade, score } };
}

export function gradeBadge(grade, verification) {
    if (!grade) return '';
    const v = verification === 'agent_verified'
        ? '<span class="seal-verified">✔ Agent-verified</span>'
        : '<span class="badge badge-neutral">Seller-declared (not verified)</span>';
    return `<p style="margin-top:8px;"><strong>Condition grade: ${escapeHtml(grade)}</strong> ${v}</p>`;
}
