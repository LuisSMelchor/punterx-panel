"use strict";

/** Normaliza texto simple (quita acentos) */
function normTxt(s){
  return String(s || "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

/** Liga → nombre canónico simple (sin mapas gigantes) */
function normalizeLeagueHint(league){
  const x = normTxt(league).toLowerCase();
  if (!x) return league;
  if (/(^|\b)mls(\b|$)|major league soccer/.test(x)) return "Major League Soccer";
  if (/^\s*premier league\s*$/.test(x)) return "Premier League";
  if (/\bserie a\b(?!.*brazil)/.test(x)) return "Serie A";
  if (/la liga|laliga/.test(x)) return "La Liga";
  if (/\bbundesliga\b/.test(x)) return "Bundesliga";
  return league;
}

/** País → alias común */
function normalizeCountryHint(country){
  const x = normTxt(country).toUpperCase();
  if (x==="USA" || x==="US" || x==="UNITED STATES") return "USA";
  if (x==="UK" || x==="UNITED KINGDOM" || x==="GB" || x==="ENGLAND") return "England";
  if (x==="UAE") return "UAE";
  if (x==="KOREA" || x==="SOUTH KOREA" || x==="KOREA REPUBLIC") return "Korea Republic";
  return country || "";
}

/** Equipos: quita ruido común (FC, SC, etc.) */
function normalizeTeam(t){
  let s = normTxt(t);
  s = s.replace(/\b(FC|CF|SC|AC|AS|CD|UD|CA|FK|IF|BK|SK|SV|AIK|BSC|TSV|SS|US|SD|Club|Deportivo|Sporting)\b\.?/gi, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s || t;
}

/** Fecha → "YYYY-MM-DD" (UTC) o vacío si inválida */
function normalizeWhenText(when){
  const raw = String(when || "").trim();
  if (!raw) return "";
  const d = new Date(raw);
  if (!isFinite(d)){
    const m = raw.match(/^\d{4}-\d{2}-\d{2}$/);
    return m ? raw : "";
  }
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth()+1).padStart(2,"0");
  const dd = String(d.getUTCDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}

/** EVT completo */
function normalizeEvt(evt){
  if (!evt || typeof evt !== "object") return evt;
  return {
    ...evt,
    home: normalizeTeam(evt.home),
    away: normalizeTeam(evt.away),
    league_hint: normalizeLeagueHint(evt.league_hint),
    country_hint: normalizeCountryHint(evt.country_hint),
    when_text: normalizeWhenText(evt.when_text),
  };
}

module.exports = {
  normTxt,
  normalizeLeagueHint,
  normalizeCountryHint,
  normalizeTeam,
  normalizeWhenText,
  normalizeEvt,
};
