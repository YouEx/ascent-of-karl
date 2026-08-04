// Step 0-skal: beviser at appen bygger, kører og er 100 % data-drevet fra
// /content. Rigtig engine, fortæller og UI kommer i Step 1-3.
import elementsData from "../content/elements.json";
import combosData from "../content/combos.json";
import { findCombo, indexCombos } from "./core/combine";
import type { Combo, Element, Flags } from "./core/types";

const elements = (elementsData as { elements: Element[] }).elements;
const comboIndex = indexCombos((combosData as { combos: Combo[] }).combos);

const discovered = new Set(elements.filter((e) => e.start).map((e) => e.id));
const flags: Flags = {};
let selected: string | null = null;

const app = document.querySelector<HTMLDivElement>("#app")!;
const byId = new Map(elements.map((e) => [e.id, e]));

function render(message: string): void {
  app.innerHTML = `
    <h1>Kolde Karl</h1>
    <p class="narrator">${message}</p>
    <div class="grid">
      ${[...discovered]
        .map((id) => byId.get(id)!)
        .map(
          (e) => `
            <button data-id="${e.id}" class="${selected === e.id ? "selected" : ""}">
              <span class="ikon">${e.ikon}</span>${e.navn}
            </button>`,
        )
        .join("")}
    </div>`;

  for (const button of app.querySelectorAll<HTMLButtonElement>("button[data-id]")) {
    button.addEventListener("click", () => pick(button.dataset.id!));
  }
}

function pick(id: string): void {
  if (selected === null) {
    selected = id;
    render("…");
    return;
  }
  const combo = findCombo(comboIndex, selected, id, flags);
  selected = null;
  if (!combo) {
    render("Intet. Absolut intet. Historien noterer det ikke engang.");
    return;
  }
  for (const flag of combo.flags_sat) flags[flag] = true;
  const isNew = !discovered.has(combo.resultat);
  discovered.add(combo.resultat);
  render(isNew ? combo.flavor : "Det har du allerede opdaget, Karl.");
}

render("Karl fryser. Gør noget.");
