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

function buildSkillData(item) {
  const s = item.system ?? {};
  return {
    name:        item.name,
    description: s.description ?? "",
    overcome:    s.overcome    ?? "",
    caa:         s.caa         ?? "",
    attack:      s.attack      ?? "",
    defend:      s.defend      ?? "",
    pc:          true,
    rank:        0,
    adhoc:       false,
    hidden:      false,
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
    // If aspect is missing or when_marked is not true the text field won't render.
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

  // 1. Sync Skill items → world skill list on the world data actor.
  const skillItems = game.items.filter(i => isSkillItem(i));
  if (skillItems.length) {
    const patch = {};
    for (const item of skillItems) patch[tob64(item.name)] = buildSkillData(item);
    await wd.update({ "system.skills": patch });
    console.log(`${MODULE_ID} | Synced ${skillItems.length} skill(s) to world skill list.`);
  }

  // 2. Patch world track templates so new characters automatically get
  //    Resolve linked to Mental Stress. The Fate system copies these world
  //    templates onto new characters at creation time.
  const worldTracks = foundry.utils.duplicate(wd.system.tracks);
  if (patchTracks(worldTracks)) {
    await wd.update({ "system.tracks": worldTracks });
    console.log(`${MODULE_ID} | Patched world tracks for Resolve.`);
  }

  // 3. Patch existing character tracks with the Resolve linked_skills entries.
  //    The Fate system calls setupTracks automatically when a player changes
  //    their skill ranks, which recalculates stress box counts from linked_skills.
  //    We only need to ensure the entries exist — no need to call setupTracks here.
  for (const actor of game.actors) {
    if (actor.type !== "fate-core-official") continue;
    const actorTracks = foundry.utils.duplicate(actor.system.tracks);
    if (!patchTracks(actorTracks)) continue;
    await actor.update({ "system.tracks": actorTracks }, { render: false });
    console.log(`${MODULE_ID} | Patched tracks for: ${actor.name}`);
  }
});

// ── CRUD hooks ────────────────────────────────────────────────────────────────

Hooks.on("createItem", async (item, _options, _userId) => {
  if (!isSkillItem(item) || !game.user.isGM) return;
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
  const patch = { [tob64(item.name)]: buildSkillData(item) };
  if (_pendingSkillRename) {
    patch[_pendingSkillRename] = foundry.utils._del;
    _pendingSkillRename = null;
  }
  await fcoConstants.wd().update({ "system.skills": patch });
});

Hooks.on("deleteItem", async (item, _options, _userId) => {
  if (!isSkillItem(item) || !game.user.isGM) return;
  await fcoConstants.wd().update({
    "system.skills": { [tob64(item.name)]: foundry.utils._del },
  });
});
