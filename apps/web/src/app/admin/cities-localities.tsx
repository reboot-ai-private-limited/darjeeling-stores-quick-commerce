"use client";

import { useEffect, useState, type FormEvent } from "react";
import { GOOGLE_MAPS_KEY, GoogleLocationPicker } from "./google-map";
import { adminFetch } from "./session-client";

interface City {
  id: string;
  name: string;
  state: string;
  isActive: boolean;
}

interface Locality {
  id: string;
  cityId: string;
  name: string;
  location: { lat: number; lng: number };
  zoneId: string | null;
  travelMinutes: number | null;
  sortOrder: number;
  isActive: boolean;
}

interface ZoneOption {
  id: string;
  name: string;
  cityId: string;
}

export default function CitiesLocalities() {
  const [tab, setTab] = useState<"cities" | "localities">("cities");

  // Cities state
  const [cities, setCities] = useState<City[] | null>(null);
  const [cityError, setCityError] = useState("");
  const [cityAttempt, setCityAttempt] = useState(0);
  const [editingCity, setEditingCity] = useState<City | "new" | null>(null);
  const [cityName, setCityName] = useState("");
  const [cityState, setCityState] = useState("");
  const [cityActive, setCityActive] = useState(true);
  const [cityBusy, setCityBusy] = useState(false);
  const [cityFormError, setCityFormError] = useState("");

  // Localities state
  const [localities, setLocalities] = useState<Locality[] | null>(null);
  const [localityError, setLocalityError] = useState("");
  const [localityAttempt, setLocalityAttempt] = useState(0);
  const [selectedCityFilter, setSelectedCityFilter] = useState("");
  const [editingLocality, setEditingLocality] = useState<Locality | "new" | null>(null);
  const [locCityId, setLocCityId] = useState("");
  const [locName, setLocName] = useState("");
  const [locLat, setLocLat] = useState("");
  const [locLng, setLocLng] = useState("");
  const [locZoneId, setLocZoneId] = useState("");
  const [locTravelMinutes, setLocTravelMinutes] = useState("");
  const [locSortOrder, setLocSortOrder] = useState("0");
  const [locActive, setLocActive] = useState(true);
  const [localityBusy, setLocalityBusy] = useState(false);
  const [localityFormError, setLocalityFormError] = useState("");

  // Zones for zoneId dropdown
  const [zones, setZones] = useState<ZoneOption[]>([]);

  // Load cities
  useEffect(() => {
    const controller = new AbortController();
    setCityError("");
    async function loadCities() {
      try {
        const res = await adminFetch("/api/v1/admin/cities", { signal: controller.signal });
        if (res.status === 401) throw new Error("Your session has expired. Sign out and sign in again.");
        if (res.status === 403) throw new Error("Permission denied: zones:manage with all-warehouse scope required.");
        if (!res.ok) throw new Error("Cities could not be loaded.");
        const body = await res.json();
        setCities(body.data ?? []);
      } catch (err) {
        if (!controller.signal.aborted) {
          setCityError(err instanceof Error ? err.message : "Failed to load cities.");
        }
      }
    }
    void loadCities();
    return () => controller.abort();
  }, [cityAttempt]);

  // Load zones for locality linking
  useEffect(() => {
    const controller = new AbortController();
    async function loadZones() {
      try {
        const res = await adminFetch("/api/v1/admin/zones", { signal: controller.signal });
        if (res.ok) {
          const body = await res.json();
          setZones(
            (body.data ?? []).map((z: { id: string; name: string; cityId: string }) => ({
              id: z.id,
              name: z.name,
              cityId: z.cityId,
            }))
          );
        }
      } catch {}
    }
    void loadZones();
    return () => controller.abort();
  }, []);

  // Load localities
  useEffect(() => {
    const controller = new AbortController();
    setLocalityError("");
    async function loadLocalities() {
      try {
        const query = selectedCityFilter ? `?cityId=${encodeURIComponent(selectedCityFilter)}` : "";
        const res = await adminFetch(`/api/v1/admin/localities${query}`, { signal: controller.signal });
        if (res.status === 401) throw new Error("Your session has expired. Sign out and sign in again.");
        if (res.status === 403) throw new Error("Permission denied: zones:manage with all-warehouse scope required.");
        if (!res.ok) throw new Error("Localities could not be loaded.");
        const body = await res.json();
        setLocalities(body.data ?? []);
      } catch (err) {
        if (!controller.signal.aborted) {
          setLocalityError(err instanceof Error ? err.message : "Failed to load localities.");
        }
      }
    }
    void loadLocalities();
    return () => controller.abort();
  }, [localityAttempt, selectedCityFilter]);

  // City mutations
  function openCityEdit(city: City | "new") {
    setEditingCity(city);
    setCityFormError("");
    if (city === "new") {
      setCityName("");
      setCityState("West Bengal");
      setCityActive(true);
    } else {
      setCityName(city.name);
      setCityState(city.state);
      setCityActive(city.isActive);
    }
  }

  async function saveCity(e: FormEvent) {
    e.preventDefault();
    setCityBusy(true);
    setCityFormError("");

    try {
      const isNew = editingCity === "new";
      const path = isNew ? "/api/v1/admin/cities" : `/api/v1/admin/cities/${(editingCity as City).id}`;
      const method = isNew ? "POST" : "PUT";
      const body = isNew
        ? { name: cityName, state: cityState }
        : { name: cityName, state: cityState, isActive: cityActive };

      const res = await adminFetch(path, {
        method,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message ?? "City could not be saved.");
      }

      setEditingCity(null);
      setCityAttempt((v) => v + 1);
    } catch (err) {
      setCityFormError(err instanceof Error ? err.message : "City could not be saved.");
    } finally {
      setCityBusy(false);
    }
  }

  // Locality mutations
  function openLocalityEdit(loc: Locality | "new") {
    setEditingLocality(loc);
    setLocalityFormError("");
    if (loc === "new") {
      setLocCityId(selectedCityFilter || (cities && cities.length > 0 ? cities[0]!.id : ""));
      setLocName("");
      setLocLat(GOOGLE_MAPS_KEY ? "" : "27.0410");
      setLocLng(GOOGLE_MAPS_KEY ? "" : "88.2663");
      setLocZoneId("");
      setLocTravelMinutes("");
      setLocSortOrder("0");
      setLocActive(true);
    } else {
      setLocCityId(loc.cityId);
      setLocName(loc.name);
      setLocLat(String(loc.location.lat));
      setLocLng(String(loc.location.lng));
      setLocZoneId(loc.zoneId ?? "");
      setLocTravelMinutes(loc.travelMinutes !== null ? String(loc.travelMinutes) : "");
      setLocSortOrder(String(loc.sortOrder));
      setLocActive(loc.isActive);
    }
  }

  async function saveLocality(e: FormEvent) {
    e.preventDefault();
    setLocalityBusy(true);
    setLocalityFormError("");

    try {
      const isNew = editingLocality === "new";
      const path = isNew ? "/api/v1/admin/localities" : `/api/v1/admin/localities/${(editingLocality as Locality).id}`;
      const method = isNew ? "POST" : "PUT";

      const latNum = parseFloat(locLat);
      const lngNum = parseFloat(locLng);
      if (isNaN(latNum) || isNaN(lngNum)) {
        throw new Error("Latitude and Longitude must be valid numbers.");
      }

      const travelNum = locTravelMinutes ? parseInt(locTravelMinutes, 10) : null;
      const sortNum = locSortOrder ? parseInt(locSortOrder, 10) : 0;

      const body = isNew
        ? {
            cityId: locCityId,
            name: locName,
            location: { lat: latNum, lng: lngNum },
            zoneId: locZoneId || null,
            travelMinutes: travelNum,
            sortOrder: sortNum,
          }
        : {
            cityId: locCityId,
            name: locName,
            location: { lat: latNum, lng: lngNum },
            zoneId: locZoneId || null,
            travelMinutes: travelNum,
            sortOrder: sortNum,
            isActive: locActive,
          };

      const res = await adminFetch(path, {
        method,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message ?? "Locality could not be saved.");
      }

      setEditingLocality(null);
      setLocalityAttempt((v) => v + 1);
    } catch (err) {
      setLocalityFormError(err instanceof Error ? err.message : "Locality could not be saved.");
    } finally {
      setLocalityBusy(false);
    }
  }

  const zonesForSelectedCity = zones.filter((z) => !locCityId || z.cityId === locCityId);

  return (
    <>
      <div className="admin-heading">
        <div>
          <h1>Cities &amp; Localities</h1>
          <p>Manage serviced cities and neighborhood drop-down locations.</p>
        </div>
        <div className="admin-role-actions">
          {tab === "cities" ? (
            <button
              className="admin-role-button"
              disabled={cityBusy}
              onClick={() => openCityEdit("new")}
            >
              Create city
            </button>
          ) : (
            <button
              className="admin-role-button"
              disabled={localityBusy}
              onClick={() => openLocalityEdit("new")}
            >
              Create locality
            </button>
          )}
        </div>
      </div>

      <div className="admin-tab-nav" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "cities"}
          className={tab === "cities" ? "is-active" : ""}
          onClick={() => setTab("cities")}
        >
          Cities ({cities?.length ?? 0})
        </button>
        <button
          role="tab"
          aria-selected={tab === "localities"}
          className={tab === "localities" ? "is-active" : ""}
          onClick={() => setTab("localities")}
        >
          Localities ({localities?.length ?? 0})
        </button>
      </div>

      {tab === "cities" && (
        <>
          {cityFormError && <p className="admin-role-error" role="alert">{cityFormError}</p>}
          {cityError ? (
            <div className="admin-panel admin-roles-message" role="alert">
              <p>{cityError}</p>
              <button onClick={() => setCityAttempt((v) => v + 1)}>Try again</button>
            </div>
          ) : !cities ? (
            <p role="status">Loading cities…</p>
          ) : (
            <>
              {editingCity && (
                <form
                  className="admin-panel admin-role-form is-wide"
                  onSubmit={saveCity}
                  aria-label={editingCity === "new" ? "Create city" : "Edit city"}
                >
                  <h2>{editingCity === "new" ? "Create city" : `Edit ${editingCity.name}`}</h2>
                  <p className="admin-form-hint">
                    {editingCity === "new"
                      ? "A city only needs a name and state. After saving, draw its delivery zones under Zones, then add localities here."
                      : "Changing the name updates it everywhere customers see it."}
                  </p>
                  <div className="admin-form-row" style={{ marginTop: 18 }}>
                    <label className="admin-field" htmlFor="city-name">
                      City name *
                      <input id="city-name" value={cityName} onChange={(e) => setCityName(e.target.value)} required maxLength={100} disabled={cityBusy} placeholder="e.g. Siliguri" />
                    </label>
                    <label className="admin-field" htmlFor="city-state">
                      State *
                      <input id="city-state" value={cityState} onChange={(e) => setCityState(e.target.value)} required maxLength={100} disabled={cityBusy} placeholder="e.g. West Bengal" />
                    </label>
                  </div>
                  {editingCity !== "new" && (
                    <label className="admin-check" style={{ marginTop: 8 }}>
                      <input type="checkbox" checked={cityActive} onChange={(e) => setCityActive(e.target.checked)} disabled={cityBusy} />
                      <span>Active for the public picker and orders</span>
                    </label>
                  )}
                  <div className="admin-form-actions">
                    <button className="admin-role-button" type="submit" disabled={cityBusy}>{cityBusy ? "Saving…" : "Save city"}</button>
                    <button type="button" disabled={cityBusy} onClick={() => setEditingCity(null)}>Cancel</button>
                  </div>
                </form>
              )}

              <section className="admin-panel" aria-labelledby="cities-title">
                <div className="admin-panel-toolbar">
                  <h2 id="cities-title">Serviced Cities</h2>
                  <span>{cities.length} cities</span>
                </div>
                {cities.length === 0 ? (
                  <p className="admin-roles-message">No cities configured yet.</p>
                ) : (
                  <div className="admin-geo-grid">
                    {cities.map((city) => (
                      <article key={city.id} className="admin-geo-card">
                        <h3>
                          <span>{city.name}</span>
                          <span
                            className={`admin-badge ${
                              city.isActive ? "admin-badge-active" : "admin-badge-inactive"
                            }`}
                          >
                            {city.isActive ? "Active" : "Inactive"}
                          </span>
                        </h3>
                        <p>{city.state}</p>
                        <div className="admin-role-actions" style={{ padding: "8px 0 0" }}>
                          <button disabled={cityBusy} onClick={() => openCityEdit(city)}>
                            Edit city
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}

      {tab === "localities" && (
        <>
          {localityFormError && <p className="admin-role-error" role="alert">{localityFormError}</p>}
          {localityError ? (
            <div className="admin-panel admin-roles-message" role="alert">
              <p>{localityError}</p>
              <button onClick={() => setLocalityAttempt((v) => v + 1)}>Try again</button>
            </div>
          ) : (
            <>
              {editingLocality && (
                <form
                  className="admin-panel admin-role-form is-wide"
                  onSubmit={saveLocality}
                  aria-label={editingLocality === "new" ? "Create locality" : "Edit locality"}
                >
                  <h2>{editingLocality === "new" ? "Create locality" : `Edit ${editingLocality.name}`}</h2>
                  <p className="admin-form-hint">A locality is a neighbourhood customers pick when they enter an address. Click the map to place it.</p>
                  <div className="admin-locality-grid">
                    <div style={{ display: "grid", gap: 16 }}>
                      <label className="admin-field" htmlFor="loc-city">
                        City *
                        <select id="loc-city" value={locCityId} onChange={(e) => setLocCityId(e.target.value)} required disabled={localityBusy}>
                          <option value="">Select a city</option>
                          {(cities ?? []).map((c) => (
                            <option key={c.id} value={c.id}>{c.name} ({c.state})</option>
                          ))}
                        </select>
                      </label>
                      <label className="admin-field" htmlFor="loc-name">
                        Locality name *
                        <input id="loc-name" value={locName} onChange={(e) => setLocName(e.target.value)} required maxLength={100} disabled={localityBusy} placeholder="e.g. Chowrasta" />
                      </label>
                      <label className="admin-field" htmlFor="loc-zone">
                        Linked zone (optional)
                        <select id="loc-zone" value={locZoneId} onChange={(e) => setLocZoneId(e.target.value)} disabled={localityBusy}>
                          <option value="">None (find the zone from the map point)</option>
                          {zonesForSelectedCity.map((z) => (
                            <option key={z.id} value={z.id}>{z.name}</option>
                          ))}
                        </select>
                      </label>
                      <div className="admin-form-row">
                        <label className="admin-field" htmlFor="loc-travel">
                          Travel minutes (delivery time)
                          <input id="loc-travel" type="number" min="0" value={locTravelMinutes} onChange={(e) => setLocTravelMinutes(e.target.value)} disabled={localityBusy} placeholder="8" />
                        </label>
                        <label className="admin-field" htmlFor="loc-sort">
                          Sort order
                          <input id="loc-sort" type="number" min="0" value={locSortOrder} onChange={(e) => setLocSortOrder(e.target.value)} disabled={localityBusy} placeholder="0" />
                        </label>
                      </div>
                      {editingLocality !== "new" && (
                        <label className="admin-check">
                          <input type="checkbox" checked={locActive} onChange={(e) => setLocActive(e.target.checked)} disabled={localityBusy} />
                          <span>Active for the customer address picker</span>
                        </label>
                      )}
                    </div>

                    <div style={{ display: "grid", gap: 14 }}>
                      <strong style={{ fontSize: 15 }}>Location on the map *</strong>
                      {GOOGLE_MAPS_KEY && (
                        <GoogleLocationPicker
                          lat={locLat.trim() === "" || Number.isNaN(parseFloat(locLat)) ? null : parseFloat(locLat)}
                          lng={locLng.trim() === "" || Number.isNaN(parseFloat(locLng)) ? null : parseFloat(locLng)}
                          zones={[]} selectedZoneId="" disabled={localityBusy}
                          onPick={(la, ln) => { setLocLat(la.toFixed(6)); setLocLng(ln.toFixed(6)); }}
                        />
                      )}
                      <div className="admin-form-row">
                        <label className="admin-field" htmlFor="loc-lat">
                          Latitude *
                          <input id="loc-lat" type="number" step="any" value={locLat} onChange={(e) => setLocLat(e.target.value)} required disabled={localityBusy} placeholder="27.0410" />
                        </label>
                        <label className="admin-field" htmlFor="loc-lng">
                          Longitude *
                          <input id="loc-lng" type="number" step="any" value={locLng} onChange={(e) => setLocLng(e.target.value)} required disabled={localityBusy} placeholder="88.2663" />
                        </label>
                      </div>
                    </div>
                  </div>
                  <div className="admin-form-actions">
                    <button className="admin-role-button" type="submit" disabled={localityBusy}>{localityBusy ? "Saving…" : "Save locality"}</button>
                    <button type="button" disabled={localityBusy} onClick={() => setEditingLocality(null)}>Cancel</button>
                  </div>
                </form>
              )}

              <section className="admin-panel" aria-labelledby="localities-title">
                <div className="admin-staff-filters">
                  <label>
                    Filter by City:
                    <select
                      value={selectedCityFilter}
                      onChange={(e) => setSelectedCityFilter(e.target.value)}
                    >
                      <option value="">All Cities</option>
                      {(cities ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="admin-panel-toolbar">
                  <h2 id="localities-title">Localities</h2>
                  <span>{localities?.length ?? 0} localities</span>
                </div>

                {!localities ? (
                  <p role="status">Loading localities…</p>
                ) : localities.length === 0 ? (
                  <p className="admin-roles-message">No localities found.</p>
                ) : (
                  <div className="admin-geo-grid">
                    {localities.map((loc) => {
                      const linkedZone = zones.find((z) => z.id === loc.zoneId);
                      const cityName = cities?.find((c) => c.id === loc.cityId)?.name ?? "City";

                      return (
                        <article key={loc.id} className="admin-geo-card">
                          <h3>
                            <span>{loc.name}</span>
                            <span
                              className={`admin-badge ${
                                loc.isActive ? "admin-badge-active" : "admin-badge-inactive"
                              }`}
                            >
                              {loc.isActive ? "Active" : "Inactive"}
                            </span>
                          </h3>
                          <p>{cityName} · Order {loc.sortOrder}</p>
                          <div className="admin-geo-meta">
                            <span>
                              GPS: {loc.location.lat.toFixed(4)}, {loc.location.lng.toFixed(4)}
                            </span>
                            {loc.travelMinutes !== null && <span>ETA fallback: {loc.travelMinutes}m</span>}
                            <span>Zone: {linkedZone ? linkedZone.name : "Resolved by GPS point"}</span>
                          </div>
                          <div className="admin-role-actions" style={{ padding: "8px 0 0" }}>
                            <button disabled={localityBusy} onClick={() => openLocalityEdit(loc)}>
                              Edit locality
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}
