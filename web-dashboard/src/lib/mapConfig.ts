const rawKey = import.meta.env.VITE_CARTO_API_KEY || 'eyJhbGciOiJIUzI1NiJ9.eyJhIjoiYWNfZTI1MWYybHciLCJqdGkiOiIwMmUyMmRiNSJ9.7scQaCjdCZZnb0WDR9EsmehIBXlC2e_zv9IyCFwWEKc';

const keyParam = rawKey ? `?key=${rawKey}&api_key=${rawKey}` : '';

export const CARTO_DARK_MAP_URL = `https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png${keyParam}`;

export const CARTO_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
