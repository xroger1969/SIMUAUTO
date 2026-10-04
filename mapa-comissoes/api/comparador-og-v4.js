import React from 'react';
import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

export default function handler() {
  const h = React.createElement;
  const green = '#35e6a5';
  const navy = '#071826';

  const pill = (text) => h('div', {
    style: {
      display: 'flex', padding: '10px 16px', borderRadius: 999,
      border: '1px solid rgba(255,255,255,.18)',
      background: 'rgba(255,255,255,.06)',
      color: '#dbe8ee', fontSize: 15, fontWeight: 600
    }
  }, text);

  const metric = (label, value, dark=false) => h('div', {
    style: {
      flex: 1, display: 'flex', flexDirection: 'column',
      borderRadius: 20, padding: '18px 20px',
      background: dark ? '#0b2237' : '#ffffff',
      border: dark ? '1px solid #17384f' : '1px solid #d8e5eb'
    }
  },
    h('div', {
      style: {
        fontSize: 13, color: dark ? '#b8c8d1' : '#6c7c87',
        fontWeight: 700, letterSpacing: '.5px'
      }
    }, label),
    h('div', {
      style: {
        marginTop: 8, fontSize: 34, lineHeight: 1,
        fontWeight: 800, color: dark ? '#ffffff' : '#15966b'
      }
    }, value)
  );

  return new ImageResponse(
    h('div', {
      style: {
        width: '1200px', height: '630px', display: 'flex',
        position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(135deg,#06131f 0%,#0d2942 58%,#dcecf1 100%)',
        color: '#fff'
      }
    },
      h('div', {
        style: {
          position: 'absolute', right: -100, top: -150,
          width: 520, height: 520, borderRadius: 260,
          background: 'rgba(53,230,165,.14)', display: 'flex'
        }
      }),
      h('div', {
        style: {
          width: '50%', height: '100%', display: 'flex',
          flexDirection: 'column', justifyContent: 'space-between',
          padding: '58px 34px 52px 64px'
        }
      },
        h('div', { style: { display: 'flex', alignItems: 'center' } },
          h('div', {
            style: {
              width: 82, height: 82, borderRadius: 41,
              border: '10px solid rgba(255,255,255,.95)',
              display: 'flex', alignItems: 'center',
              justifyContent: 'center', marginRight: 22
            }
          },
            h('div', {
              style: {
                width: 38, height: 10, borderRadius: 6,
                background: green, transform: 'rotate(-38deg)',
                transformOrigin: 'left center',
                marginLeft: 30, marginTop: 12, display: 'flex'
              }
            })
          ),
          h('div', { style: { display: 'flex', flexDirection: 'column' } },
            h('div', {
              style: {
                fontSize: 54, fontWeight: 800,
                lineHeight: 1, letterSpacing: '-2px'
              }
            }, 'Comparador'),
            h('div', {
              style: {
                fontSize: 58, fontWeight: 800,
                lineHeight: 1.02, letterSpacing: '-2px', color: green
              }
            }, 'Auto Pro')
          )
        ),
        h('div', {
          style: {
            display: 'flex', flexDirection: 'column', maxWidth: 510
          }
        },
          h('div', {
            style: {
              fontSize: 31, fontWeight: 650,
              lineHeight: 1.25, color: '#eff6f8'
            }
          }, 'Avalie viaturas com rapidez e inteligência.'),
          h('div', {
            style: {
              fontSize: 20, lineHeight: 1.4,
              color: '#b5c8d2', marginTop: 18
            }
          }, 'Preço de mercado, compra ideal e venda rápida numa só análise.')
        ),
        h('div', { style: { display: 'flex', gap: 12 } },
          pill('Análise IA'),
          pill('Mercado profissional'),
          pill('Decisão de compra')
        )
      ),
      h('div', {
        style: {
          width: '50%', height: '100%', display: 'flex',
          alignItems: 'center', justifyContent: 'center', paddingRight: 44
        }
      },
        h('div', {
          style: {
            width: 540, height: 486, borderRadius: 30,
            background: '#f7fbfc', color: navy,
            display: 'flex', flexDirection: 'column',
            padding: 26, border: '1px solid rgba(255,255,255,.8)'
          }
        },
          h('div', {
            style: {
              display: 'flex', alignItems: 'center',
              justifyContent: 'space-between'
            }
          },
            h('div', { style: { display: 'flex', alignItems: 'center' } },
              h('div', {
                style: {
                  width: 13, height: 13, borderRadius: 7,
                  background: green, marginRight: 9, display: 'flex'
                }
              }),
              h('div', {
                style: { fontSize: 18, fontWeight: 800 }
              }, 'Comparador Auto Pro')
            ),
            h('div', {
              style: { fontSize: 13, color: '#61737f', fontWeight: 700 }
            }, 'ANÁLISE')
          ),
          h('div', {
            style: {
              marginTop: 22, height: 58, borderRadius: 16,
              background: '#ffffff', border: '1px solid #d8e5eb',
              display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', padding: '0 15px'
            }
          },
            h('div', {
              style: { fontSize: 16, color: '#7b8992' }
            }, 'Cole o link, matrícula ou descrição…'),
            h('div', {
              style: {
                display: 'flex', padding: '10px 18px',
                borderRadius: 12, background: green,
                color: '#063120', fontSize: 15, fontWeight: 800
              }
            }, 'Analisar')
          ),
          h('div', {
            style: {
              display: 'flex', justifyContent: 'space-between',
              alignItems: 'flex-end', marginTop: 22
            }
          },
            h('div', { style: { display: 'flex', flexDirection: 'column' } },
              h('div', {
                style: { fontSize: 13, color: '#6d7d87', fontWeight: 700 }
              }, 'VIATURA ANALISADA'),
              h('div', {
                style: { fontSize: 26, fontWeight: 800, marginTop: 5 }
              }, 'Tesla Model Y'),
              h('div', {
                style: { fontSize: 15, color: '#6d7d87', marginTop: 4 }
              }, 'Long Range · 2023 · Automático')
            ),
            h('div', {
              style: {
                display: 'flex', padding: '8px 12px',
                borderRadius: 999, background: '#e8fbf4',
                color: '#167c5a', fontSize: 13, fontWeight: 800
              }
            }, 'Confiança alta')
          ),
          h('div', {
            style: { display: 'flex', gap: 12, marginTop: 20 }
          },
            metric('COMPRA IDEAL', '31.500 €', true),
            metric('VENDA RÁPIDA', '35.900 €', false)
          ),
          h('div', {
            style: {
              display: 'flex', flexDirection: 'column',
              marginTop: 15, borderRadius: 18,
              background: '#ffffff', border: '1px solid #d8e5eb',
              padding: 18
            }
          },
            h('div', {
              style: {
                display: 'flex', justifyContent: 'space-between'
              }
            },
              h('div', {
                style: { fontSize: 14, fontWeight: 700 }
              }, 'Posição no mercado'),
              h('div', {
                style: { fontSize: 13, color: '#15966b', fontWeight: 800 }
              }, 'COMPETITIVO')
            ),
            h('div', {
              style: {
                display: 'flex', alignItems: 'center', marginTop: 20
              }
            },
              h('div', {
                style: {
                  flex: 1, height: 9, borderRadius: 5,
                  background: '#e4eaee', display: 'flex', overflow: 'hidden'
                }
              },
                h('div', {
                  style: {
                    width: '68%', height: '100%',
                    background: 'linear-gradient(90deg,#9cf0d2,#35e6a5)',
                    display: 'flex'
                  }
                })
              ),
              h('div', {
                style: { marginLeft: 12, fontSize: 14, fontWeight: 800 }
              }, '68%')
            )
          )
        )
      )
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable, no-transform'
      }
    }
  );
}
