const MAP: Record<string, string> = {
  "tipper":         "Tipper.png",
  "excavator":      "Excavator.png",
  "grader":         "Grader.png",
  "dozer":          "Dozer.png",
  "jcb":            "JCB.png",
  "diesel tanker":  "Diesel_Tanker.png",
  "driller":        "Driller.png",
  "hydra":          "Hydra.png",
  "soil compactor": "Soil_Compactor.png",
};

export function equipPhoto(category: string): string {
  return `/equip_photos/${MAP[category.toLowerCase()] ?? "Tipper.png"}`;
}
