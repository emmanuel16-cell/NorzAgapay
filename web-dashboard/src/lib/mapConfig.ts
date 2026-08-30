const apiKey = import.meta.env.VITE_CARTO_API_KEY ? `?api_key=${import.meta.env.VITE_CARTO_API_KEY}` : '';

export const CARTO_DARK_MAP_URL = `https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png${apiKey}`;

export const CARTO_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
