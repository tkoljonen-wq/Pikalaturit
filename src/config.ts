/**
 * Sovelluksen konfiguraatio. Pikalaturin raja on koodissa konfiguraatio,
 * ei kovakoodattu maagiseksi luvuksi (suunnitelma §7, §12.7).
 */
export interface AppConfig {
  /** Pikalaturin minimiteho kilowatteina. */
  fastChargerMinPowerKw: number;
  /**
   * Lasketaanko DC-laturi, jolta puuttuu tehotieto (power_unknown), mukaan
   * pikalaturitilastoon. MVP:n oletus on false (suunnitelma §7).
   */
  includeUnknownPowerDc: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
  fastChargerMinPowerKw: 50,
  includeUnknownPowerDc: false,
};

/** AFIR antaa tehon watteina; muunnos kilowateiksi. */
export const wattsToKw = (watts: number): number => watts / 1000;
