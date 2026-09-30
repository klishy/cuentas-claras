# Categorías de gastos disponibles. Sin emojis: cada una se muestra como un
# círculo de color con una abreviación de 2 letras (estilo Splitwise).
CATEGORIES = {
    "arriendo":     {"label": "Arriendo",     "abbr": "AR", "color": "#7A3B72"},
    "supermercado": {"label": "Supermercado", "abbr": "SU", "color": "#F0606B"},
    "comida":       {"label": "Comida",       "abbr": "CO", "color": "#F9A66C"},
    "transporte":   {"label": "Transporte",   "abbr": "TR", "color": "#9A6FC3"},
    "servicios":    {"label": "Servicios",    "abbr": "SE", "color": "#E58AA0"},
    "salidas":      {"label": "Salidas",      "abbr": "SA", "color": "#C96B9E"},
    "salud":        {"label": "Salud",        "abbr": "SL", "color": "#F28B82"},
    "otros":        {"label": "Otros",        "abbr": "OT", "color": "#A99AB5"},
}

VALID_CATEGORIES = set(CATEGORIES.keys())
