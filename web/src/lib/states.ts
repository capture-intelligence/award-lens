/**
 * US states + territories — used for the Place of Performance filter.
 *
 * Codes are 2-letter USPS abbreviations. USAspending's
 * `place_of_performance_locations` filter expects { country: "USA", state: <code> }.
 */

export interface USState {
  code: string;   // e.g. "TX"
  name: string;   // e.g. "Texas"
  group: 'state' | 'dc' | 'territory';
}

export const US_STATES: USState[] = [
  { code: 'AL', name: 'Alabama',         group: 'state' },
  { code: 'AK', name: 'Alaska',          group: 'state' },
  { code: 'AZ', name: 'Arizona',         group: 'state' },
  { code: 'AR', name: 'Arkansas',        group: 'state' },
  { code: 'CA', name: 'California',      group: 'state' },
  { code: 'CO', name: 'Colorado',        group: 'state' },
  { code: 'CT', name: 'Connecticut',     group: 'state' },
  { code: 'DE', name: 'Delaware',        group: 'state' },
  { code: 'FL', name: 'Florida',         group: 'state' },
  { code: 'GA', name: 'Georgia',         group: 'state' },
  { code: 'HI', name: 'Hawaii',          group: 'state' },
  { code: 'ID', name: 'Idaho',           group: 'state' },
  { code: 'IL', name: 'Illinois',        group: 'state' },
  { code: 'IN', name: 'Indiana',         group: 'state' },
  { code: 'IA', name: 'Iowa',            group: 'state' },
  { code: 'KS', name: 'Kansas',          group: 'state' },
  { code: 'KY', name: 'Kentucky',        group: 'state' },
  { code: 'LA', name: 'Louisiana',       group: 'state' },
  { code: 'ME', name: 'Maine',           group: 'state' },
  { code: 'MD', name: 'Maryland',        group: 'state' },
  { code: 'MA', name: 'Massachusetts',   group: 'state' },
  { code: 'MI', name: 'Michigan',        group: 'state' },
  { code: 'MN', name: 'Minnesota',       group: 'state' },
  { code: 'MS', name: 'Mississippi',     group: 'state' },
  { code: 'MO', name: 'Missouri',        group: 'state' },
  { code: 'MT', name: 'Montana',         group: 'state' },
  { code: 'NE', name: 'Nebraska',        group: 'state' },
  { code: 'NV', name: 'Nevada',          group: 'state' },
  { code: 'NH', name: 'New Hampshire',   group: 'state' },
  { code: 'NJ', name: 'New Jersey',      group: 'state' },
  { code: 'NM', name: 'New Mexico',      group: 'state' },
  { code: 'NY', name: 'New York',        group: 'state' },
  { code: 'NC', name: 'North Carolina',  group: 'state' },
  { code: 'ND', name: 'North Dakota',    group: 'state' },
  { code: 'OH', name: 'Ohio',            group: 'state' },
  { code: 'OK', name: 'Oklahoma',        group: 'state' },
  { code: 'OR', name: 'Oregon',          group: 'state' },
  { code: 'PA', name: 'Pennsylvania',    group: 'state' },
  { code: 'RI', name: 'Rhode Island',    group: 'state' },
  { code: 'SC', name: 'South Carolina',  group: 'state' },
  { code: 'SD', name: 'South Dakota',    group: 'state' },
  { code: 'TN', name: 'Tennessee',       group: 'state' },
  { code: 'TX', name: 'Texas',           group: 'state' },
  { code: 'UT', name: 'Utah',            group: 'state' },
  { code: 'VT', name: 'Vermont',         group: 'state' },
  { code: 'VA', name: 'Virginia',        group: 'state' },
  { code: 'WA', name: 'Washington',      group: 'state' },
  { code: 'WV', name: 'West Virginia',   group: 'state' },
  { code: 'WI', name: 'Wisconsin',       group: 'state' },
  { code: 'WY', name: 'Wyoming',         group: 'state' },

  { code: 'DC', name: 'District of Columbia', group: 'dc' },

  { code: 'PR', name: 'Puerto Rico',                 group: 'territory' },
  { code: 'VI', name: 'U.S. Virgin Islands',         group: 'territory' },
  { code: 'GU', name: 'Guam',                        group: 'territory' },
  { code: 'MP', name: 'Northern Mariana Islands',    group: 'territory' },
  { code: 'AS', name: 'American Samoa',              group: 'territory' },
];

export function stateName(code: string): string {
  return US_STATES.find((s) => s.code === code)?.name ?? code;
}
