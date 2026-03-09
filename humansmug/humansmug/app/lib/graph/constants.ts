import type { ColorDef } from "./types";

export const TYPE_COLORS: Record<string, ColorDef> = {
  PERSON: { bg: "#0e1d35", border: "#5b8dff", accent: "#5b8dff" },
  ORGANIZATION: { bg: "#0b2619", border: "#4af0b0", accent: "#4af0b0" },
  MEANS_OF_TRANSPORTATION: { bg: "#231d08", border: "#ffd166", accent: "#ffd166" },
  ROUTES: { bg: "#241010", border: "#ff6b6b", accent: "#ff6b6b" },
  LOCATION: { bg: "#1a0e2a", border: "#c084fc", accent: "#c084fc" },
  EVENT: { bg: "#0a1d24", border: "#38bdf8", accent: "#38bdf8" },
  DEFAULT: { bg: "#141820", border: "#6272a4", accent: "#6272a4" },
};

export const getColor = (category: string) => {
  const key = (category || "").toUpperCase();
  return TYPE_COLORS[key] || TYPE_COLORS.DEFAULT;
};

export const DEFAULT_GRAPH_INPUT = `("entity"{tuple_delimiter}SAI DESHPANDE{tuple_delimiter}PERSON{tuple_delimiter}A known smuggler responsible for transporting migrants in an 18-wheeler across the US-Mexico border)
{record_delimiter}
("entity"{tuple_delimiter}SMUGGLER{tuple_delimiter}PERSON{tuple_delimiter}An individual engaged in illegal human smuggling activities for profit)
{record_delimiter}
("entity"{tuple_delimiter}18-WHEELER{tuple_delimiter}MEANS_OF_TRANSPORTATION{tuple_delimiter}A large commercial truck used to conceal and transport undocumented migrants)
{record_delimiter}
("entity"{tuple_delimiter}US-MEXICO BORDER{tuple_delimiter}ROUTES{tuple_delimiter}The primary crossing point exploited during the smuggling operation)
{record_delimiter}
("entity"{tuple_delimiter}CARTEL NETWORK{tuple_delimiter}ORGANIZATION{tuple_delimiter}Criminal organization that coordinates and finances the smuggling routes)
{record_delimiter}
("relationship"{tuple_delimiter}SAI DESHPANDE{tuple_delimiter}SMUGGLER{tuple_delimiter}Identified as primary smuggler{tuple_delimiter}8)
{record_delimiter}
("relationship"{tuple_delimiter}SAI DESHPANDE{tuple_delimiter}18-WHEELER{tuple_delimiter}Drove the truck carrying migrants{tuple_delimiter}9)
{record_delimiter}
("relationship"{tuple_delimiter}SAI DESHPANDE{tuple_delimiter}CARTEL NETWORK{tuple_delimiter}Works under cartel direction{tuple_delimiter}7)
{record_delimiter}
("relationship"{tuple_delimiter}18-WHEELER{tuple_delimiter}US-MEXICO BORDER{tuple_delimiter}Used to cross the border{tuple_delimiter}8)
{record_delimiter}
("relationship"{tuple_delimiter}CARTEL NETWORK{tuple_delimiter}US-MEXICO BORDER{tuple_delimiter}Controls smuggling routes{tuple_delimiter}9)
{record_delimiter}
{completion_delimiter}`;
