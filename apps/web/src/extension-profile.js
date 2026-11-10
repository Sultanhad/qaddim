// The profile as the extension receives it: one flat object of things you said about yourself.
//
// It is its own file because two readers need exactly the same shape — the page that hands it
// to the extension, and scripts/measure-forms.mjs, which asks how many real forms that shape
// can answer. A measurement taken against a different profile than the one sent measures nothing.
import { CITY_COUNTRY } from '../../../packages/engine/src/taxonomy.js';

// Forms are in English and ask for a country by name; the profile knows it by the city you chose.
const COUNTRY_EN = {
  sa: 'Saudi Arabia', ae: 'United Arab Emirates', qa: 'Qatar', bh: 'Bahrain',
  kw: 'Kuwait', om: 'Oman', eg: 'Egypt', jo: 'Jordan'
};

export function forExtension(profile) {
  const cityId = (profile.cities || [])[0] || '';
  const city = cityId.replace(/(^|\s)\S/g, (c) => c.toUpperCase());      // "abu dhabi" → "Abu Dhabi"
  const country = COUNTRY_EN[CITY_COUNTRY[cityId]] || '';
  const facts = profile.answers?._facts ?? {};
  const nationality = String(profile.nationality || '').trim();
  const name = String(profile.full_name || '').trim();
  return {
    full_name: name, first_name: name.split(' ')[0] || '', last_name: name.split(' ').slice(1).join(' '),
    email_for_applications: profile.email_for_applications, phone: profile.phone,
    city, country, location: [city, country].filter(Boolean).join(', '),
    nationality,
    // "Are you a Saudi national?" is asked as often as "what is your nationality", and the
    // answer to one follows from the other. With no nationality written, neither is answered.
    saudi_national: !nationality ? '' : /سعودي|saudi/i.test(nationality) ? 'yes' : 'no',
    // Sponsorship is not sent as a yes or a no any more. It was derived from a column no screen
    // ever set, so it said "no" for everyone, everywhere; the extension now works it out from
    // this and from the job's country, or leaves the question to you.
    work_authorization: profile.work_authorization,
    salary_expectation: profile.salary_expectation, current_salary: profile.current_salary,
    notice_period: profile.notice_period, current_company: profile.current_company,
    current_title: profile.current_title, years_experience: String(profile.years_experience ?? ''),
    linkedin_url: profile.linkedin_url, education_degree: profile.education_degree,
    university: profile.university, graduation_year: String(profile.graduation_year ?? ''),
    gender: facts.gender ?? '', date_of_birth: facts.date_of_birth ?? '', marital_status: facts.marital_status ?? '',
    answers: profile.answers ?? {},
    auto_submit: !!profile.auto_submit,
    // where the CV lives; the extension fetches the bytes itself with this same token
    cv_path: profile.cv_path ?? null
  };
}
