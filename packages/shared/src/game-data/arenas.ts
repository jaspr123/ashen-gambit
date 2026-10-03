export interface ArenaDef {
  id: string;
  name: string;
  description: string;
  /** Environment preset consumed by the client's ArenaEnvironment. */
  environment: 'ruined_city' | 'highway_overpass' | 'foundry';
  fogColor: string;
  sky: [string, string];
  sunColor: string;
  ambient: string;
}

export const ARENAS: ArenaDef[] = [
  { id: 'ruined_city', name: 'Ground Zero', description: 'A reinforced platform in the shell of a dead downtown.', environment: 'ruined_city', fogColor: '#3a2f27', sky: ['#17130f', '#8a5230'], sunColor: '#ffb070', ambient: '#6a5648' },
  { id: 'highway', name: 'The Overpass', description: 'Bolted onto a collapsed highway interchange.', environment: 'highway_overpass', fogColor: '#2d3135', sky: ['#111317', '#55606c'], sunColor: '#c8d4e0', ambient: '#4a525c' },
  { id: 'foundry', name: 'The Foundry', description: 'Machine territory. The furnaces still burn.', environment: 'foundry', fogColor: '#2a1a12', sky: ['#120a06', '#6a2e10'], sunColor: '#ff7a30', ambient: '#553525' },
];
