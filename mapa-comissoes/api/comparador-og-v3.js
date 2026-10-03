const React = require('react');

module.exports = async function handler(req, res) {
  const { ImageResponse } = await import('@vercel/og');
  const h = React.createElement;
  const green = '#35e6a5';
  const ink = '#071826';
  const navy = '#0b2237';

  const pill = (label) => h('div', {
    style: {
      display: 'flex', padding: '10px 15px', borderRadius: '999px',
      border: '1px solid rgba(255,255,255,.18)', background: 'rgba(4,19,31,.36)',
      fontSize: 15, color: '#d8e4ea'
    }
  }, label);

  const tree = h('div', {
    style: {
      width: '100%', height: '100%', display: 'flex', position: 'relative',
      overflow: 'hidden',
      background: 'linear-gradient(135deg, #061421 0%, #0d2a43 55%, #dcecf1 100%)',
      color: '#ffffff', fontFamily: 'Noto Sans'
    }
  },
    h('div', {
      style: {
        position: 'absolute', right: '-90px', top: '-130px', width: '520px', height: '520px',
        borderRadius: '260px', background: 'rgba(53,230,165,0.16)', display: 'flex'
      }
    }),
    h('div', {
      style: {
        position: 'absolute', left: '-120px', bottom: '-180px', width: '520px', height: '520px',
        borderRadius: '260px', background: 'rgba(255,255,255,0.06)', display: 'flex'
      }
    }),

    h('div', {
      style: {
        width: '51%', height: '100%', display: 'flex', flexDirection: 'column',
        padding: '58px 34px 54px 66px', justifyContent: 'space-between'
      }
    },
      h('div', { style: { display: 'flex', alignItems: 'center' } },
        h('div', {
          style: {
            width: '82px', height: '82px', borderRadius: '41px',
            border: '10px solid rgba(255,255,255,0.94)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', marginRight: '22px',
            position: 'relative'
          }
        },
          h('div', {
            style: {
              width: '39px', height: '10px', borderRadius: '5px', background: green,
              transform: 'rotate(-38deg)', transformOrigin: 'left center',
              marginLeft: '30px', marginTop: '12px', display: 'flex'
            }
          })
        ),
        h('div', { style: { display: 'flex', flexDirection: 'column' } },
          h('div', { style: { fontSize: 54, lineHeight: 1, fontWeight: 800, letterSpacing: '-2px' } }, 'Comparador'),
          h('div', { style: { fontSize: 58, lineHeight: 1.05, fontWeight: 800, letterSpacing: '-2px', color: green } }, 'Auto Pro')
        )
      ),

      h('div', { style: { display: 'flex', flexDirection: 'column', marginTop: '6px' } },
        h('div', {
          style: { fontSize: 31, lineHeight: 1.26, fontWeight: 600, color: '#e9f0f4', maxWidth: '520px' }
        }, 'Avalie viaturas com rapidez e inteligência.'),
        h('div', {
          style: { fontSize: 20, lineHeight: 1.4, marginTop: '17px', color: '#abc0cc', maxWidth: '510px' }
        }, 'Preço de mercado, compra ideal e venda rápida numa só análise.')
      ),

      h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } },
        pill('Análise IA'),
        pill('Mercado profissional'),
        pill('Decisão de compra')
      )
    ),

    h('div', {
      style: {
        width: '49%', height: '100%', display: 'flex', alignItems: 'center',
        justifyContent: 'center', paddingRight: '52px'
      }
    },
      h('div', {
        style: {
          width: '535px', height: '484px', borderRadius: '30px', background: '#f8fbfc',
          color: ink, display: 'flex', flexDirection: 'column', padding: '26px',
          border: '1px solid rgba(255,255,255,.8)'
        }
      },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          h('div', { style: { display: 'flex', alignItems: 'center' } },
            h('div', {
              style: { width: 13, height: 13, borderRadius: '7px', background: green, marginRight: '9px', display: 'flex' }
            }),
            h('div', { style: { fontSize: 18, fontWeight: 800 } }, 'Comparador Auto Pro')
          ),
          h('div', { style: { fontSize: 13, color: '#60717d' } }, 'ANÁLISE')
        ),

        h('div', {
          style: {
            marginTop: '22px', height: '58px', borderRadius: '16px', background: '#ffffff',
            border: '1px solid #dbe5ea', display: 'flex', alignItems: 'center',
            padding: '0 16px', justifyContent: 'space-between'
          }
        },
          h('div', { style: { fontSize: 16, color: '#7b8992' } }, 'Cole o link, matrícula ou descrição…'),
          h('div', {
            style: {
              display: 'flex', borderRadius: '12px', background: green, color: '#063120',
              fontWeight: 800, padding: '10px 18px', fontSize: 15
            }
          }, 'Analisar')
        ),

        h('div', {
          style: { display: 'flex', marginTop: '22px', justifyContent: 'space-between', alignItems: 'flex-end' }
        },
          h('div', { style: { display: 'flex', flexDirection: 'column' } },
            h('div', { style: { fontSize: 13, color: '#6d7d87', marginBottom: '4px' } }, 'VIATURA ANALISADA'),
            h('div', { style: { fontSize: 25, fontWeight: 800 } }, 'Tesla Model Y'),
            h('div', { style: { fontSize: 15, color: '#6d7d87', marginTop: '4px' } }, 'Long Range · 2023 · Automático')
          ),
          h('div', {
            style: {
              display: 'flex', padding: '8px 12px', borderRadius: '999px',
              background: '#e8fbf4', color: '#167c5a', fontWeight: 800, fontSize: 13
            }
          }, 'Confiança alta')
        ),

        h('div', { style: { display: 'flex', marginTop: '20px', gap: '12px' } },
          h('div', {
            style: {
              flex: 1, display: 'flex', flexDirection: 'column', background: navy,
              color: '#fff', borderRadius: '18px', padding: '18px'
            }
          },
            h('div', { style: { fontSize: 13, color: '#b9c9d3' } }, 'COMPRA IDEAL'),
            h('div', { style: { fontSize: 33, fontWeight: 800, marginTop: '7px' } }, '31.500 €')
          ),
          h('div', {
            style: {
              flex: 1, display: 'flex', flexDirection: 'column', background: '#ffffff',
              border: '1px solid #dbe5ea', borderRadius: '18px', padding: '18px'
            }
          },
            h('div', { style: { fontSize: 13, color: '#6d7d87' } }, 'VENDA RÁPIDA'),
            h('div', { style: { fontSize: 33, fontWeight: 800, marginTop: '7px', color: '#15966b' } }, '35.900 €')
          )
        ),

        h('div', {
          style: {
            display: 'flex', marginTop: '15px', height: '112px', borderRadius: '18px',
            background: '#ffffff', border: '1px solid #dbe5ea', padding: '18px',
            flexDirection: 'column'
          }
        },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
            h('div', { style: { fontSize: 14, fontWeight: 700 } }, 'Posição no mercado'),
            h('div', { style: { fontSize: 13, color: '#15966b', fontWeight: 800 } }, 'COMPETITIVO')
          ),
          h('div', { style: { display: 'flex', alignItems: 'center', marginTop: '20px' } },
            h('div', {
              style: {
                flex: 1, height: '9px', borderRadius: '5px', background: '#e4eaee',
                display: 'flex', overflow: 'hidden'
              }
            },
              h('div', {
                style: {
                  width: '68%', height: '100%',
                  background: 'linear-gradient(90deg,#9cf0d2,#35e6a5)', display: 'flex'
                }
              })
            ),
            h('div', { style: { marginLeft: '12px', fontSize: 14, fontWeight: 800 } }, '68%')
          )
        )
      )
    )
  );

  const image = new ImageResponse(tree, { width: 1200, height: 630 });
  const body = Buffer.from(await image.arrayBuffer());

  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, immutable, no-transform, max-age=31536000');
  res.end(body);
};
