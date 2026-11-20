import { describe, expect, it } from 'vitest'
import { spotifyTrackFromEmbed } from '../../src/routes/characters'

describe('Spotify card metadata', () => {
  it('reads a track and every credited artist from Spotify embed data', () => {
    const html = '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"state":{"data":{"entity":{"name":"Night Drive","artists":[{"name":"Aster"},{"name":"Marlowe"}]}}}}}}</script>'
    expect(spotifyTrackFromEmbed(html)).toEqual({ song: 'Night Drive', artist: 'Aster, Marlowe' })
  })
})
