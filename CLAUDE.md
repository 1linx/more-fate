# more-fate — Foundry VTT Module

A Foundry VTT module for the **Fate Core Official** system. It adds a custom `skill` Item type so GMs can create world-level skills via the standard Items interface, and patches character tracks to link a custom "Resolve" skill to Mental Stress.

## What the module does

1. **Custom `skill` Item type** — GMs create Items of type "Skill" with five text fields: `description`, `overcome`, `caa` (Create an Advantage), `attack`, `defend`.
2. **World skill sync** — On startup and on every create/update/delete of a Skill item, the module writes matching entries into the Fate system's `game.settings` skill registry (`fate-core-official` › `skills`). Keys are base-64 encoded skill names using the same `tob64` function as `fcoConstants`.
3. **Resolve track patching** — On startup the module adds "Resolve" as a linked skill to Mental Stress and the Mental Mild Consequence track (mirroring how Physique links to Physical Stress). This runs idempotently against both world track templates and each existing `fate-core-official` actor.

## System dependency

Requires the **fate-core-official** system, currently at version `4.7.14.12` (verified against Foundry v14.361).

The Fate system lives at:
`~/Library/Application Support/FoundryVTT/Data/systems/fate-core-official/`

Key system internals used:
- `fcoConstants.wd()` — returns `fromUuidSync(game.settings.get("fate-core-official", "wid"))`, the special world-data actor that stores all world-level game data. **Skills and tracks live here, not in `game.settings` directly.**
- `fcoConstants.wd().system.skills` — world skill list (object keyed by `tob64(name)`)
- `fcoConstants.wd().system.tracks` — world track templates
- `fcoConstants.wd().update({"system.skills": {[key]: data}})` — add/update a skill (Foundry merges partial objects)
- `fcoConstants.wd().update({"system.skills": {[key]: foundry.utils._del}})` — delete a skill (`foundry.utils._del` is the `ForcedDeletion` marker)
- `actor.setupTracks(skills, tracks)` — recalculates stress box counts after track changes (defined in `fcoActor.js`)
- `fcoConstants` is a global class loaded via the system's non-module `scripts` list — accessible from our ES module as a global
- `fcoConstants.tob64` — our `tob64()` helper must match this exactly

## Foundry v14 API notes

The module was migrated from v12 to v14. Key patterns used:

- **Sheet**: `HandlebarsApplicationMixin(foundry.applications.sheets.ItemSheetV2)` — NOT the old `ItemSheet`
- **Sheet options**: `static DEFAULT_OPTIONS` + `static PARTS` — NOT `static get defaultOptions()`
- **Context**: `_prepareContext(options)` — NOT `getData()`
- **Register sheet**: `foundry.documents.collections.Items.registerSheet(...)` — NOT `Items.registerSheet(...)`
- **No `loadTemplates()`** — templates are loaded automatically via `PARTS`
- **Template root**: each PARTS template must have exactly **one root HTML element** (we use `<div class="more-fate-skill-inner flexcol">`)

## File structure

```
module.json                          Module manifest (v14, requires fate-core-official)
scripts/main.mjs                     All module logic — single entry point
templates/skill-item-sheet.html      Handlebars template for the Skill item sheet
styles/skill-sheet.css               CSS for the Skill sheet
lang/en.json                         Localisation (type labels only)
packs/skills/                        LevelDB compendium — "More Fate Default Skills"
skills.md                            Design notes: skill descriptions for the compendium
instructions.md                      Original brief for the module
scripts/SkillItemModel.mjs           (unused — not loaded by module.json)
scripts/SkillItemSheet.mjs           (unused — not loaded by module.json)
```

## Known design decisions

- **`StringField` not `HTMLField`** — skill fields (description, overcome, etc.) are plain text stored as strings. We switched from `HTMLField` during the v14 migration because the content is plain prose, not rich HTML.
- **`SKILL_TYPES` array** — both `"skill"` and `"more-fate.skill"` are registered to handle Foundry's namespaced sub-type storage.
- **Rename handling** — `preUpdateItem` captures the old key before a name change; `updateItem` deletes the old key and writes the new one. A module-level `_pendingSkillRename` variable bridges the two hooks.

## Compendium pack

`packs/skills/` is a LevelDB compendium ("More Fate Default Skills") of type `Item` for system `fate-core-official`. All 15 skills are fully populated.

### Compendium workflow

**Source of truth:** `src/skills/*.json` — one JSON file per skill (e.g. `src/skills/resolve.json`).

**To add or edit a skill:** edit or add a file in `src/skills/`, then rebuild:
```
node build-pack.mjs
```

**To deploy to Foundry:**
1. Close Foundry (the LevelDB is locked while it's running)
2. `cp -r packs/skills/* "~/Library/Application Support/FoundryVTT/Data/modules/more-fate/packs/skills/"`
3. Restart Foundry

Do not edit `packs/skills/` directly — always go via `src/skills/` + `build-pack.mjs`.

Foundry modifies its own copy of the LevelDB (different `.ldb` file numbers) so the installed copy diverges from the workspace. The workflow above is the safe way to push updates.

## What still needs doing

- Test the full create/rename/delete cycle for Skill items in a live Foundry v14 world
- Verify the Resolve track patching works correctly on new and existing characters
- Consider whether the sheet needs richer text editing (ProseMirror) for the description fields instead of plain textareas
