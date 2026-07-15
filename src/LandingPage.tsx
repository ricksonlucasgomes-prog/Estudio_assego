import {
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  PackageCheck,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import './landing.css';

type LandingPageProps = {
  onLogin: () => void;
};

const FEATURES = [
  {
    icon: CalendarDays,
    title: 'Agenda sem conflito',
    description: 'Consulte horários livres, solicite o estúdio e acompanhe cada aprovação em um só fluxo.',
  },
  {
    icon: PackageCheck,
    title: 'Equipamentos sob controle',
    description: 'Retirada, devolução, foto e conferência com histórico completo — nada se perde.',
  },
  {
    icon: ShieldCheck,
    title: 'Seguro e rastreável',
    description: 'Acesso por perfil, termo digital assinado e registros auditáveis de cada operação.',
  },
];

const STEPS = [
  { n: '01', title: 'Solicite', text: 'Escolha data, horário e informe o programa e os participantes.' },
  { n: '02', title: 'Aprovação', text: 'A diretoria avalia; você recebe o retorno no app e por e-mail.' },
  { n: '03', title: 'Grave', text: 'Chegue com tudo previamente preparado pela equipe do estúdio.' },
  { n: '04', title: 'Finalize', text: 'Termo aceito, materiais e devoluções registrados ao final.' },
];

// Microfone + faixa de áudio (mesmo símbolo do ícone do app).
function MicMark() {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label="Assego Studio">
      <defs>
        <linearGradient id="lp-metal" gradientUnits="userSpaceOnUse" x1="32" y1="6" x2="32" y2="36">
          <stop offset="0" stopColor="#BFD9F7" /><stop offset="0.2" stopColor="#8FBAF0" />
          <stop offset="0.6" stopColor="#4E8BD8" /><stop offset="1" stopColor="#255C9E" />
        </linearGradient>
        <linearGradient id="lp-deep" gradientUnits="userSpaceOnUse" x1="32" y1="30" x2="32" y2="49">
          <stop offset="0" stopColor="#5E93D8" /><stop offset="1" stopColor="#1E4272" />
        </linearGradient>
      </defs>
      <rect x="24" y="6" width="16" height="30" rx="8" fill="url(#lp-metal)" stroke="#CFE3FF" strokeOpacity="0.35" />
      <g stroke="#0C1D34" strokeOpacity="0.5" strokeWidth="1.4" strokeLinecap="round">
        <line x1="27.5" y1="14" x2="36.5" y2="14" /><line x1="27.5" y1="19" x2="36.5" y2="19" /><line x1="27.5" y1="24" x2="36.5" y2="24" />
      </g>
      <path d="M20 30 a12 12 0 0 0 24 0" fill="none" stroke="url(#lp-deep)" strokeWidth="3.4" strokeLinecap="round" />
      <line x1="32" y1="42" x2="32" y2="49" stroke="url(#lp-deep)" strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  );
}

export function LandingPage({ onLogin }: LandingPageProps) {
  return (
    <main className="lp">
      <div className="lp-shell">
        <header className="lp-nav">
          <a className="lp-brand" href="#topo" aria-label="Assego Studio — início">
            <span className="logo"><img src="/logo.png" alt="ASSEGO PM & BM" /></span>
            <span><b>ASSEGO Studio</b><span>PM &amp; BM</span></span>
          </a>
          <nav className="lp-nav-links" aria-label="Navegação">
            <a href="#recursos">Recursos</a>
            <a href="#processo">Como funciona</a>
            <a href="#estudio">Estúdio</a>
          </nav>
          <button type="button" className="lp-cta" onClick={onLogin}>
            Entrar <ArrowRight size={16} aria-hidden="true" />
          </button>
        </header>
      </div>

      <div className="lp-shell" id="topo">
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <span className="lp-pill"><i aria-hidden="true" /> Painel oficial do estúdio</span>
            <h1>O estúdio da ASSEGO,<br /><em>sob controle.</em></h1>
            <p className="sub">
              Agende gravações, controle equipamentos e conduza a rotina do estúdio de podcast da ASSEGO PM &amp; BM com clareza, segurança e registro de tudo.
            </p>
            <div className="lp-actions">
              <button type="button" className="lp-cta" onClick={onLogin}>
                Acessar plataforma <ArrowRight size={18} aria-hidden="true" />
              </button>
              <a className="lp-ghost" href="#recursos">Conhecer recursos</a>
            </div>
            <div className="lp-trust" aria-label="Diferenciais">
              <span><Check size={15} aria-hidden="true" /> Acesso controlado</span>
              <span><Check size={15} aria-hidden="true" /> Histórico completo</span>
              <span><Smartphone size={15} aria-hidden="true" /> Instalável no iPhone</span>
            </div>
          </div>

          <div className="lp-stage" aria-hidden="true">
            <span className="rec"><i /> REC · ASSEGO STUDIO</span>
            <div className="mic"><MicMark /></div>
            <div className="lp-eq"><span /><span /><span /><span /><span /><span /><span /></div>
            <p className="cap">Do agendamento à entrega, em um só lugar.</p>
          </div>
        </section>
      </div>

      <div className="lp-shell">
        <section className="lp-section" id="recursos">
          <span className="lp-kicker">Gestão centralizada</span>
          <h2>Tudo o que o estúdio precisa.<br />Nada além do necessário.</h2>
          <p className="lead">Menos planilhas e mensagens soltas. Mais autonomia para a equipe e visibilidade para a diretoria.</p>
          <div className="lp-cards">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <article className="lp-card" key={title}>
                <span className="ic"><Icon size={22} aria-hidden="true" /></span>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="lp-section" id="processo">
          <span className="lp-kicker">Fluxo simples</span>
          <h2>Da solicitação à conclusão em quatro passos.</h2>
          <div className="lp-steps">
            {STEPS.map(({ n, title, text }) => (
              <div className="lp-step" key={n}>
                <b>{n}</b>
                <strong>{title}</strong>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-section" id="estudio" style={{ paddingBottom: 0 }}>
          <div className="lp-hours">
            <span className="ic"><Clock3 size={28} aria-hidden="true" /></span>
            <div>
              <h3>Funcionamento do estúdio</h3>
              <p>
                <b>Seg. a sex.</b> das 9h às 17h · <b>Sáb.</b> das 9h às 12h. Horário após as 17h somente com autorização.
                Equipamentos apenas com registro de retirada e devolução.
              </p>
            </div>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-final">
            <div>
              <span className="lp-kicker">Assego Studio</span>
              <h2>Seu próximo agendamento começa aqui.</h2>
              <p>Acesse a plataforma e organize toda a operação do estúdio em um só lugar.</p>
            </div>
            <button type="button" className="lp-cta" onClick={onLogin}>
              Entrar no sistema <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
        </section>

        <footer className="lp-footer">
          <a className="lp-brand" href="#topo">
            <span className="logo"><img src="/logo.png" alt="ASSEGO PM & BM" /></span>
            <span><b>ASSEGO Studio</b><span>PM &amp; BM</span></span>
          </a>
          <span>Plataforma interna de gestão do estúdio · Desenvolvido por Lucas Rickson</span>
        </footer>
      </div>
    </main>
  );
}

export default LandingPage;
