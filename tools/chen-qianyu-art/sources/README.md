# Chen Qianyu battle outfit sources

The maintainer supplied the close-up Chen Qianyu figure reference and authorized publication of this existing
cosmetic pack. Original Ch'en rig/boot art: © Hypergryph. The pack's existing notices remain applicable.

`outfit-front.png` and `outfit-back.png` were edited using the built-in imagegen tool, with the figure photograph
as a clothing reference and labeled, unrotated atlas pieces as edit targets. The back edit also used the front
result as a palette reference. Transparent output was requested. The two small `boot-*.png` pieces retain the
existing front boot artwork, used in both views for consistency.

The later `refinement-identity.png`, `refinement-gloves.png` and `refinement-tailoring.png` edits use four additional
owner-supplied game close-ups: the gray eyes with red slit pupils and pink horn roots; the blue gloves; the pale sage
apron over white pleats; and the hood-free back neckline. They use built-in imagegen, with the exact three prompts
saved in [refinement-prompts.json](refinement-prompts.json). Existing per-region textures, not whole-body paintings,
were the edit targets. The new dark stocking pieces fully cover the lower legs in both views.

## Prompt set

Use case: precise-object-edit. Asset type: transparent chibi Spine garment sheet.
Edit the existing pieces to match the supplied Chen Qianyu outfit: lighter sky-blue cropped jacket, black lower
sleeves, white pleated A-line mini skirt instead of pants, pale bare thighs, and existing dark boots. Preserve
chibi linework, shading, attachment orientation, cell order and isolation; do not add a body, text, labels,
background, hair, face, horns or weapons. Keep the black, white, teal and magenta details from the references.
For the back sheet, match the front sheet's palette and render the same clothes from behind.

Each sheet is a 4-column grid, in the following row-major order:

Front: `F_L_Coat`, `F_R_Coat`, `F_Chest`, `F_Waist_A`, `F_L_Hood`, `F_R_Hood`, `F_L_Shoulder`,
`F_R_Shoulder`, `F_L_Arm`, `F_R_Arm`, `F_Hip`, `F_Waist_B`, `F_L_Leg`, `F_R_Leg`, `F_L_Calf`, `F_R_Calf`.

Back: `B_Coat`, `B_Chest`, `B_Hip`, `B_Waist`, `B_Hood`, `B_L_Shoulder`, `B_R_Shoulder`, `B_L_Arm`,
`B_R_Arm`, `B_L_Leg`, `B_R_Leg`, `B_L_Calf`, `B_R_Calf` (remaining cells empty).

## Assembly

Run `node tools/chen-qianyu-art/apply-outfit.mjs`. The builder isolates each garment, resamples it with
premultiplied alpha and restores atlas rotation. Semantic rig names differ from the generated sheet labels:
the generated `Hip` skirt goes into the last-drawn `Waist` attachment, `Calf` skin goes on the upper `Leg`,
and the existing boots go on `Calf`. The later refinements replace identity, gloves, skirt, collar and stockings.
Both eye clusters are retained, so connected-component cleanup cannot erase one eye. The collar only occupies
the top 4/21 of the old hood region. The skirt mesh is positioned at the hips with a 116-unit-wide, 75-unit-long
UV rectangle, avoiding a skirt drawn on the abdomen or a thigh painted over its hem. Coat textures end at the waist.
UV pages are enlarged once to 1024px front / 512px back with nearest-neighbor sampling, then the selected source
pieces are fitted at higher resolution; untouched pixels keep their exact colors and alpha. Bones, weights and
animation clips are preserved byte-for-byte; only skirt position floats are patched. Face skin, mouth, weapons and
existing motion-effect regions are not repainted.

Run `node --test test/plugins/chen-qianyu-outfit.test.js`, preview front and back animations, then
`node tools/plugin.mjs pack chen-qianyu-art --zip` and `node tools/plugin.mjs check chen-qianyu-art --strict`.
