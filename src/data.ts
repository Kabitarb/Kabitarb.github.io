export interface Profile {
  name: string;
  shortName: string;
  role: string;
  availability: string;
  tagline: string;
  about: string;
  approach: string;
  degree: string;
  school: string;
  email: string;
  github: string;
  linkedin: string;
}

export interface Project {
  id: string;
  title: string;
  category: 'Machine Learning' | 'Data Science';
  description: string;
  tags: string[];
  role: string;
  problem: string;
  approach: string;
  outcome: string;
  source: string;
  demo: string;
}

export interface Portfolio {
  profile: Profile;
  projects: Project[];
}

export interface SavedPortfolio {
  data: Portfolio;
  photo: Blob | null;
  resume: Blob | null;
}

export const defaultPortfolio: Portfolio = {
  profile: {
    name: 'Kabita Rajbanshi',
    shortName: 'Kabita',
    role: 'AI & Machine Learning',
    availability: 'Open to AI & ML opportunities',
    tagline:
      'I explore data, build machine learning models, and turn complex problems into thoughtful, practical solutions.',
    about:
      'I’m Kabita, a Computer Systems Engineering graduate drawn to the possibilities of artificial intelligence. I enjoy making sense of messy data and understanding the “why” behind a model’s predictions.',
    approach:
      'My projects are where theory meets practice: exploring datasets, comparing approaches, and learning through iteration. I’m looking for an entry-level AI engineering role where I can contribute, ask good questions, and keep growing.',
    degree: 'BSc (Hons) Computer Systems Engineering',
    school: 'ISMT College · University of Sunderland',
    email: 'kabitarb99@gmail.com',
    github: 'https://github.com/Kabitarb',
    linkedin: 'https://www.linkedin.com/in/kabita-rajbanshi-847633154/',
  },
  projects: [
    {
      id: 'music',
      title: 'Finding patterns in sound',
      category: 'Machine Learning',
      description:
        'Exploring how audio features and machine learning can help us understand and classify musical genres.',
      tags: ['Python', 'Scikit-learn', 'Librosa'],
      role: 'Personal / academic project',
      problem:
        'How can a model distinguish musical genres from the properties of an audio signal? This project explores genre classification using the GTZAN dataset and its extracted audio features.',
      approach:
        'I explored features including chroma, spectral centroid, tempo, and MFCCs, then compared support vector machines, decision trees, random forests, K-nearest neighbours, and a neural network. The notebook includes feature scaling, hyperparameter searches, and model evaluation.',
      outcome:
        'The project brings feature exploration and model comparison into one reproducible notebook. It gave me hands-on experience connecting signal features to classification and comparing several learning approaches. Evaluation details and limitations should be read alongside the notebook; this portfolio does not claim a production benchmark.',
      source: 'https://github.com/Kabitarb/Music-Genre-Classification',
      demo: '',
    },
    {
      id: 'health',
      title: 'A data lens on diabetes',
      category: 'Machine Learning',
      description:
        'Comparing classification models to explore the relationship between health indicators and diabetes.',
      tags: ['Python', 'LightGBM', 'Pandas'],
      role: 'Personal / academic project',
      problem:
        'Health datasets contain many interacting signals. This project uses the Diabetes Health Indicators dataset to explore which features and classification approaches can help distinguish diabetes outcomes.',
      approach:
        'I explored the data and feature selection, experimented with class balancing, and compared classifiers using Lazy Predict. The notebook also includes Optuna searches, cross-validation, ROC curves, and a LightGBM evaluation.',
      outcome:
        'A documented experiment in preprocessing, model selection, and evaluation. The work develops my understanding of imbalanced classification and the importance of examining more than a single score. It is an educational exploration, not a clinically validated diagnostic tool.',
      source: 'https://github.com/Kabitarb/Diabetes_Prediction',
      demo: '',
    },
    {
      id: 'honey',
      title: 'The story behind the honey',
      category: 'Data Science',
      description:
        'Exploring US honey production trends and bringing a regression model to life with a simple web app.',
      tags: ['Pandas', 'Scikit-learn', 'Flask'],
      role: 'Personal project',
      problem:
        'What can historical data tell us about honey production in the United States? This project explores production data and builds a regression-based forecast.',
      approach:
        'I explored historical honey production, trained a regression model, and connected the saved model to a Flask application. The app accepts a year, runs a prediction with the Joblib model, and displays the estimated production.',
      outcome:
        'The repository includes the dataset, analysis notebook, saved model, and Flask application. It connects exploratory analysis to a usable prediction interface. Forecasts remain an experiment and should be interpreted with the assumptions and limitations of the historical data in mind.',
      source: 'https://github.com/Kabitarb/Honey-Prediction',
      demo: '',
    },
  ],
};

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  );
}

export function safeUrl(value: string, optional = false): string {
  if (optional && !value.trim()) return '';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Please enter a complete URL, starting with https://.');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      'Links must use http:// or https:// without embedded credentials.',
    );
  }
  return url.href;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid portfolio data.');
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(
      `${label} is required and must be at most ${max} characters.`,
    );
  }
  return value.trim();
}

export function validatePortfolio(value: unknown): Portfolio {
  const root = record(value);
  const p = record(root.profile);
  const email = text(p.email, 'Email', 150);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error('Please enter a valid email address.');
  const profile: Profile = {
    name: text(p.name, 'Full name', 80),
    shortName: text(p.shortName, 'First name', 30),
    role: text(p.role, 'Professional title', 80),
    availability: text(p.availability, 'Availability', 100),
    tagline: text(p.tagline, 'Introduction', 350),
    about: text(p.about, 'About you', 800),
    approach: text(p.approach, 'Your approach', 800),
    degree: text(p.degree, 'Degree', 140),
    school: text(p.school, 'School', 140),
    email,
    github: safeUrl(text(p.github, 'GitHub URL', 500)),
    linkedin: safeUrl(text(p.linkedin, 'LinkedIn URL', 500)),
  };
  if (!Array.isArray(root.projects) || root.projects.length !== 3)
    throw new Error('Please provide three featured projects.');
  const projects = root.projects.map(
    (item: unknown, index: number): Project => {
      const project = record(item);
      if (
        project.category !== 'Machine Learning' &&
        project.category !== 'Data Science'
      )
        throw new Error('Select a project category.');
      if (
        !Array.isArray(project.tags) ||
        !project.tags.length ||
        project.tags.length > 6
      )
        throw new Error('Use between one and six tools per project.');
      return {
        id: defaultPortfolio.projects[index].id,
        title: text(project.title, 'Project title', 100),
        category: project.category,
        description: text(project.description, 'Project summary', 350),
        tags: project.tags.map((tag: unknown) => text(tag, 'Tool name', 35)),
        role: text(project.role, 'Your role', 100),
        problem: text(project.problem, 'Project problem'),
        approach: text(project.approach, 'Project approach'),
        outcome: text(project.outcome, 'Project outcome'),
        source: safeUrl(text(project.source, 'Source code URL', 500)),
        demo: safeUrl(
          typeof project.demo === 'string' ? project.demo : '',
          true,
        ),
      };
    },
  );
  return { profile, projects };
}

export function serializePortfolio(data: Portfolio): string {
  return JSON.stringify(validatePortfolio(data)).replace(/</g, '\\u003c');
}

export function filterProjects(
  projects: Project[],
  category: string,
): Project[] {
  return category === 'all'
    ? projects
    : projects.filter((project) => project.category === category);
}
