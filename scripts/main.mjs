const MODULE_ID = "more-fate";

// Foundry stores module sub-types as both "skill" and namespaced "more-fate.skill".
const SKILL_TYPES = ["skill", `${MODULE_ID}.skill`];

function isSkillItem(item) {
  return SKILL_TYPES.includes(item.type);
}

// Matches fcoConstants.tob64 exactly
function tob64(text) {
  const bytes = new TextEncoder().encode(text);
  const binString = String.fromCodePoint(...bytes);
  return btoa(binString).split("=").join("");
}

// Builds the world-skill entry for a Skill Item.
// Spreads existing world skill data first so fields we don't expose (bonus,
// compendium_id, etc.) are preserved when writing back.
function buildSkillData(item) {
  const s = item.system ?? {};
  const key = tob64(item.name);
  const existing = fcoConstants?.wd?.()?.system?.skills?.[key] ?? {};
  return {
    pc:     true,
    rank:   0,
    adhoc:  false,
    hidden: false,
    ...existing,
    name:        item.name,
    description: s.description ?? "",
    overcome:    s.overcome    ?? "",
    caa:         s.caa         ?? "",
    attack:      s.attack      ?? "",
    defend:      s.defend      ?? "",
  };
}

// Patches Mental Stress / Mental Mild Consequence tracks to link Resolve
// (mirroring Physique → Physical Stress), and ensures both Physical and Mental
// mild-consequence tracks have the correct aspect structure so the text field
// renders on the character sheet.  Idempotent.  Returns true if any change made.
function patchTracks(tracks) {
  const MENTAL_STRESS_NAMES      = ["Mental Stress"];
  const MENTAL_CONSEQUENCE_NAMES = ["Mental Mild Consequence", "Mild Mental Consequence"];
  const PHYS_CONSEQUENCE_NAMES   = ["Physical Mild Consequence", "Mild Physical Consequence"];
  const ALL_CONSEQUENCE_NAMES    = [...MENTAL_CONSEQUENCE_NAMES, ...PHYS_CONSEQUENCE_NAMES];

  // Correct aspect structure required for the consequence text field to render.
  const CONSEQUENCE_ASPECT = { name: "", when_marked: true, as_name: false };

  let changed = false;

  for (const key in tracks) {
    const track = tracks[key];
    const isMentalStress      = MENTAL_STRESS_NAMES.includes(track.name);
    const isMentalConsequence = MENTAL_CONSEQUENCE_NAMES.includes(track.name);
    const isConsequence       = ALL_CONSEQUENCE_NAMES.includes(track.name);

    // ── Ensure consequence tracks have the correct aspect structure ──────────
    if (isConsequence) {
      if (typeof track.aspect !== "object" || track.aspect === null ||
          track.aspect.when_marked !== true || track.aspect.as_name !== false) {
        const existingName = track.aspect?.name ?? "";
        track.aspect = { ...CONSEQUENCE_ASPECT, name: existingName };
        changed = true;
      }
    }

    // ── Link Resolve to Mental Stress / Mental Mild Consequence ──────────────
    if (!isMentalStress && !isMentalConsequence) continue;

    if (!Array.isArray(track.linked_skills)) {
      track.linked_skills = [];
      changed = true;
    }

    if (isMentalStress) {
      const has1 = track.linked_skills.some(ls => ls.linked_skill === "Resolve" && ls.rank === 1);
      const has3 = track.linked_skills.some(ls => ls.linked_skill === "Resolve" && ls.rank === 3);
      if (!has1) { track.linked_skills.push({ linked_skill: "Resolve", rank: 1, boxes: 1, enables: false }); changed = true; }
      if (!has3) { track.linked_skills.push({ linked_skill: "Resolve", rank: 3, boxes: 1, enables: false }); changed = true; }
    }

    if (isMentalConsequence) {
      const has5 = track.linked_skills.some(ls => ls.linked_skill === "Resolve" && ls.rank === 5 && ls.enables === true);
      if (!has5) { track.linked_skills.push({ linked_skill: "Resolve", rank: 5, boxes: 0, enables: true }); changed = true; }
    }
  }
  return changed;
}

let _pendingSkillRename = null;

// Set to true while we're bulk-creating Items from world skill data so that
// the createItem hook doesn't redundantly write them back.
let _importingFromWorld = false;

// ── Init ──────────────────────────────────────────────────────────────────────

Hooks.once("init", () => {
  class MoreFateSkillModel extends foundry.abstract.DataModel {
    static defineSchema() {
      const { StringField } = foundry.data.fields;
      return {
        description: new StringField({ blank: true, initial: "" }),
        overcome:    new StringField({ blank: true, initial: "" }),
        caa:         new StringField({ blank: true, initial: "" }),
        attack:      new StringField({ blank: true, initial: "" }),
        defend:      new StringField({ blank: true, initial: "" }),
      };
    }
  }

  for (const t of SKILL_TYPES) {
    CONFIG.Item.dataModels[t] = MoreFateSkillModel;
    CONFIG.Item.typeLabels[t] = "Skill";
    CONFIG.Item.typeIcons[t]  = "fa-solid fa-book";
  }

  class MoreFateSkillSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ItemSheetV2) {
    static DEFAULT_OPTIONS = {
      classes: ["more-fate-skill", "sheet", "item"],
      position: { width: 620, height: 620 },
      window: { resizable: true, icon: "fa-solid fa-book" },
      form: {
        submitOnChange: true,
        closeOnSubmit:  false,
      },
    };

    static PARTS = {
      form: {
        template: `modules/${MODULE_ID}/templates/skill-item-sheet.html`,
      },
    };

    async _prepareContext(_options) {
      const raw = this.item.toObject();
      return {
        data:   raw,
        system: raw.system ?? {},
      };
    }
  }

  foundry.documents.collections.Items.registerSheet(MODULE_ID, MoreFateSkillSheet, {
    types:       SKILL_TYPES,
    makeDefault: true,
    label:       "Skill Sheet",
  });

  console.log(`${MODULE_ID} | Initialized. Registered item types:`, SKILL_TYPES);
});

// ── Default icon for new Skill items ─────────────────────────────────────────

Hooks.on("preCreateItem", (item, data) => {
  if (!isSkillItem(item)) return;
  if (!data.img || data.img === "icons/svg/item-bag.svg") {
    item.updateSource({ img: "icons/svg/book.svg" });
  }
});

// ── Startup sync ─────────────────────────────────────────────────────────────

Hooks.once("ready", async () => {
  if (!game.user.isGM) return;

  const wd = fcoConstants.wd();
  if (!wd) {
    console.error(`${MODULE_ID} | World data actor not found — is fate-core-official active?`);
    return;
  }

  // 1. Sync any pre-existing Skill Items → world skill list.
  const skillItems = game.items.filter(i => isSkillItem(i));
  const existingItemNames = new Set(skillItems.map(i => i.name));

  if (skillItems.length) {
    const patch = {};
    for (const item of skillItems) patch[tob64(item.name)] = buildSkillData(item);
    await wd.update({ "system.skills": patch });
    console.log(`${MODULE_ID} | Synced ${skillItems.length} skill(s) to world skill list.`);
  }

  // 2. Import world skills that don't yet have a Skill Item so GMs can edit
  //    the built-in Fate Core skills through the same Items interface.
  const worldSkills = wd.system.skills ?? {};
  const toImport = Object.values(worldSkills).filter(ws => ws.name && !existingItemNames.has(ws.name));

  if (toImport.length) {
    _importingFromWorld = true;
    try {
      await Item.createDocuments(toImport.map(ws => ({
        name:   ws.name,
        type:   `${MODULE_ID}.skill`,
        img:    "icons/svg/book.svg",
        system: {
          description: ws.description ?? "",
          overcome:    ws.overcome    ?? "",
          caa:         ws.caa         ?? "",
          attack:      ws.attack      ?? "",
          defend:      ws.defend      ?? "",
        },
      })));
      console.log(`${MODULE_ID} | Imported ${toImport.length} world skill(s) as editable Items.`);
    } finally {
      _importingFromWorld = false;
    }
  }

  // 3. Patch world track templates so new characters automatically get
  //    Resolve linked to Mental Stress.
  const worldTracks = foundry.utils.duplicate(wd.system.tracks);
  if (patchTracks(worldTracks)) {
    await wd.update({ "system.tracks": worldTracks });
    console.log(`${MODULE_ID} | Patched world tracks for Resolve.`);
  }

  // 4. Patch existing character tracks with the Resolve linked_skills entries.
  for (const actor of game.actors) {
    if (actor.type !== "fate-core-official") continue;
    const actorTracks = foundry.utils.duplicate(actor.system.tracks);
    if (!patchTracks(actorTracks)) continue;
    await actor.update({ "system.tracks": actorTracks }, { render: false, noHook: true });
    console.log(`${MODULE_ID} | Patched tracks for: ${actor.name}`);
  }
});

// ── CRUD hooks ────────────────────────────────────────────────────────────────

Hooks.on("createItem", async (item, _options, _userId) => {
  if (!isSkillItem(item) || !game.user.isGM || _importingFromWorld) return;
  await fcoConstants.wd().update({
    "system.skills": { [tob64(item.name)]: buildSkillData(item) },
  });
});

Hooks.on("preUpdateItem", (item, changes) => {
  if (!isSkillItem(item)) return;
  if (changes.name !== undefined && changes.name !== item.name) {
    _pendingSkillRename = tob64(item.name);
  }
});

Hooks.on("updateItem", async (item, _changes, _options, _userId) => {
  if (!isSkillItem(item) || !game.user.isGM) return;
  const wd = fcoConstants.wd();

  if (_pendingSkillRename) {
    // Rename: remove old key and write new key atomically to avoid duplicates.
    const skills = foundry.utils.duplicate(wd.system.skills ?? {});
    delete skills[_pendingSkillRename];
    skills[tob64(item.name)] = buildSkillData(item);
    _pendingSkillRename = null;
    await wd.update({ "system.skills": skills }, { diff: false });
  } else {
    await wd.update({
      "system.skills": { [tob64(item.name)]: buildSkillData(item) },
    });
  }
});

Hooks.on("deleteItem", async (item, _options, _userId) => {
  if (!isSkillItem(item) || !game.user.isGM) return;
  const wd = fcoConstants.wd();
  const key = tob64(item.name);
  // Read the full skills object, delete the key in JS, then write it back with
  // diff:false.  Using foundry.utils._del can be swallowed by the DataModel
  // merge pipeline, leaving the deleted skill visible in the world list.
  const skills = foundry.utils.duplicate(wd.system.skills ?? {});
  if (!(key in skills)) return;
  delete skills[key];
  await wd.update({ "system.skills": skills }, { diff: false });
});
