import type { BuiltTheme, ThemePreference, ThemeSelection } from '../customization/ui-contract';
export type ThemeItem = BuiltTheme & ThemeSelection;
export interface ThemeCatalog { themes: ThemeItem[]; user: ThemePreference; project: ThemePreference; active?: ThemeItem; unavailable: boolean }
