/* ================================================================
   CamMaster by PDFdukan — i18n Translation Engine
   8-Language Context Registry: EN, UR, AR, ES, FR, DE, HI, TR
   Architecture: key-value dictionary + DOM binding via data-i18n
   Usage: setLanguage('ur') → translates all [data-i18n] elements
================================================================ */

(function (global) {
  'use strict';

  /* ══════════════════════════════════════════════════════════════
     LANGUAGE REGISTRY
  ══════════════════════════════════════════════════════════════ */
  const LANG_META = [
    { code: 'en', name: 'English',  native: 'English',   flag: '🇺🇸', dir: 'ltr' },
    { code: 'ur', name: 'Urdu',     native: 'اردو',      flag: '🇵🇰', dir: 'rtl' },
    { code: 'ar', name: 'Arabic',   native: 'العربية',   flag: '🇸🇦', dir: 'rtl' },
    { code: 'es', name: 'Spanish',  native: 'Español',   flag: '🇪🇸', dir: 'ltr' },
    { code: 'fr', name: 'French',   native: 'Français',  flag: '🇫🇷', dir: 'ltr' },
    { code: 'de', name: 'German',   native: 'Deutsch',   flag: '🇩🇪', dir: 'ltr' },
    { code: 'hi', name: 'Hindi',    native: 'हिन्दी',    flag: '🇮🇳', dir: 'ltr' },
    { code: 'tr', name: 'Turkish',  native: 'Türkçe',    flag: '🇹🇷', dir: 'ltr' },
  ];

  /* ══════════════════════════════════════════════════════════════
     TRANSLATION DICTIONARY
     Keys follow: section.element convention
  ══════════════════════════════════════════════════════════════ */
  const TRANSLATIONS = {

    /* ─────────── ENGLISH (source language) ─────────── */
    en: {
      /* Navigation */
      'nav.home':           'Home',
      'nav.tools':          'Tools',
      'nav.blog':           'Blog',
      'nav.legal':          'Legal',
      'nav.about':          'About Us',
      'nav.privacy':        'Privacy Policy',
      'nav.terms':          'Terms of Service',
      'nav.cookies':        'Cookie Policy',
      /* Header actions */
      'header.signin':      'Sign In',
      'header.signout':     'Sign Out',
      'header.account':     'Account',
      'header.search':      'Search tools… (Ctrl+K)',
      /* Hero section */
      'hero.badge':         'AI-Powered Document Scanner',
      'hero.title':         'Scan & Convert Documents with CamMaster',
      'hero.subtitle':      'Free online document scanner by PDFdukan. Auto-detect edges, enhance with AI, convert to PDF — all in your browser.',
      'hero.btn.scan':      'Smart Scan',
      'hero.btn.import':    'Import Images',
      'hero.btn.pdf':       'Import PDF',
      'hero.privacy':       '🔒 Privacy first — all files processed locally in your browser',
      /* Tool section headers */
      'tools.all':          'All Tools',
      'tools.browse':       'Browse All →',
      'tools.scanner':      '📷 Scanner',
      'tools.pdf':          '📄 PDF Converters',
      'tools.edit':         '✏️ Edit & Sign',
      'tools.image':        '🖼️ Image & Scan',
      'tools.calc':         '🔧 Calculators',
      /* Individual tool names */
      'tool.smart-scan':    'Smart Scan',
      'tool.img-to-pdf':    'Image to PDF',
      'tool.pdf-to-jpg':    'PDF to JPG',
      'tool.merge-pdf':     'Merge PDF',
      'tool.split-pdf':     'Split PDF',
      'tool.compress-pdf':  'Compress PDF',
      'tool.pdf-to-word':   'PDF to Word',
      'tool.word-to-pdf':   'Word to PDF',
      'tool.pdf-to-ppt':    'PDF to PowerPoint',
      'tool.ppt-to-pdf':    'PowerPoint to PDF',
      'tool.pdf-to-excel':  'PDF to Excel',
      'tool.excel-to-pdf':  'Excel to PDF',
      'tool.html-to-pdf':   'HTML to PDF',
      'tool.pdf-editor':    'PDF Editor',
      'tool.fill-sign':     'Fill & Sign',
      'tool.watermark':     'Watermark',
      'tool.page-numbers':  'Page Numbers',
      'tool.delete-pages':  'Delete Pages',
      'tool.ai-summarize':  'AI Summarizer',
      'tool.img-compress':  'Image Compressor & Resizer',
      'tool.ocr':           'OCR Text',
      'tool.age-calc':      'Age Calculator',
      'tool.bmi-calc':      'BMI Calculator',
      'tool.discount-calc': 'Discount Calculator',
      'tool.inheritance':   'Islamic Inheritance',
      /* Tool descriptions */
      'desc.smart-scan':    'AI edge detection',
      'desc.img-to-pdf':    'JPG/PNG → PDF',
      'desc.pdf-to-jpg':    'Extract all pages',
      'desc.merge-pdf':     'Combine PDFs',
      'desc.split-pdf':     'Divide into parts',
      'desc.compress-pdf':  'Shrink PDF file size',
      'desc.pdf-to-word':   'Text to .doc file',
      'desc.word-to-pdf':   'DOCX → PDF',
      'desc.pdf-editor':    'Edit text & objects',
      'desc.fill-sign':     'Digital signatures',
      'desc.watermark':     'Stamp all pages',
      'desc.img-compress':  'JPG, PNG, WEBP optimiser',
      'desc.ocr':           'Image to editable text',
      'desc.age-calc':      'Exact age, real-time',
      'desc.bmi-calc':      'Metric & imperial',
      'desc.discount-calc': 'Price, % & tax/GST',
      'desc.inheritance':   'Warasat Intikal Islamic',
      /* Auth modal */
      'auth.signin.title':  'Welcome back',
      'auth.signin.sub':    'Sign in to save your work across devices.',
      'auth.google':        'Continue with Google',
      'auth.or':            'or',
      'auth.email':         'Email',
      'auth.password':      'Password',
      'auth.btn.signin':    'Sign In',
      'auth.no-account':    'No account?',
      'auth.signup.free':   'Sign Up free',
      'auth.signup.title':  'Create your account',
      'auth.signup.sub':    'Free forever. No credit card required.',
      'auth.google.signup': 'Sign Up with Google',
      'auth.or.below':      'or fill in below',
      'auth.username':      'Username',
      'auth.fullname':      'Full Name',
      'auth.gender':        'Gender',
      'auth.gender.select': '— Select gender —',
      'auth.gender.m':      'Male',
      'auth.gender.f':      'Female',
      'auth.gender.o':      'Other / Prefer not to say',
      'auth.gmail':         'Gmail / Email Address',
      'auth.phone':         'Phone Number',
      'auth.optional':      'Optional',
      'auth.pw.min':        'Min. 8 chars',
      'auth.confirm-pw':    'Confirm Password',
      'auth.create-btn':    'Create Account →',
      'auth.have-account':  'Already a member?',
      'auth.go-signin':     'Sign In',
      'auth.signup':        'Sign Up',
      /* Buttons / Common */
      'btn.download':       'Download',
      'btn.cancel':         'Cancel',
      'btn.reset':          'Reset',
      'btn.process':        'Process',
      'btn.upload':         'Upload File',
      'btn.choose':         'Choose File',
      'btn.calculate':      'Calculate',
      'btn.copy':           'Copy',
      'btn.print':          'Print',
      'btn.export':         'Export',
      /* Upload box */
      'upload.drop':        'Drop documents here or click to upload',
      'upload.hint':        'Supports JPG, PNG, PDF — process multiple files at once',
      /* Footer */
      'footer.brand':       'Home of CamMaster — the best free online document scanner.',
      'footer.scanner':     'Scanner',
      'footer.pdf-tools':   'PDF Tools',
      'footer.company':     'Company',
      'footer.rights':      '© 2026 PDFdukan. All rights reserved.',
      /* Sections */
      'section.recent':     'Recent Documents',
      'section.why':        'Why Choose CamMaster by PDFdukan?',
      'section.how':        'How to Scan Documents with CamMaster',
      'section.faq':        'Frequently Asked Questions',
      /* Notifications */
      'notif.none':         'No notifications',
      'notif.mark-read':    'Mark all read',
      /* Toast messages */
      'toast.lang':         'Language changed',
      'toast.theme.dark':   'Dark mode',
      'toast.theme.light':  'Light mode',
      /* Mobile nav section headers */
      'mnav.pdf-tools':     'PDF Tools',
      'mnav.edit-sign':     'Edit & Sign',
      'mnav.image-scan':    'Image & Scan',
      'mnav.calc':          'Calculators',
      'mnav.more':          'More',
    },

    /* ─────────── URDU ─────────── */
    ur: {
      'nav.home':           'ہوم',
      'nav.tools':          'ٹولز',
      'nav.blog':           'بلاگ',
      'nav.legal':          'قانونی',
      'nav.about':          'ہمارے بارے میں',
      'nav.privacy':        'رازداری کی پالیسی',
      'nav.terms':          'سروس کی شرائط',
      'nav.cookies':        'کوکیز پالیسی',
      'header.signin':      'سائن ان',
      'header.signout':     'سائن آؤٹ',
      'header.account':     'اکاؤنٹ',
      'header.search':      'ٹولز تلاش کریں…',
      'hero.badge':         'اے آئی دستاویز اسکینر',
      'hero.title':         'CamMaster سے دستاویزات اسکین اور تبدیل کریں',
      'hero.subtitle':      'PDFdukan کا مفت آن لائن دستاویز اسکینر۔ کنارے خودکار شناخت، AI سے بہتر بنائیں، PDF میں تبدیل کریں۔',
      'hero.btn.scan':      'اسمارٹ اسکین',
      'hero.btn.import':    'تصاویر درآمد کریں',
      'hero.btn.pdf':       'PDF درآمد کریں',
      'hero.privacy':       '🔒 رازداری اول — تمام فائلیں آپ کے براؤزر میں پروسیس ہوتی ہیں',
      'tools.all':          'تمام ٹولز',
      'tools.browse':       'سب دیکھیں ←',
      'tools.scanner':      '📷 اسکینر',
      'tools.pdf':          '📄 PDF کنورٹر',
      'tools.edit':         '✏️ ترمیم اور دستخط',
      'tools.image':        '🖼️ تصویر اور اسکین',
      'tools.calc':         '🔧 کیلکولیٹر',
      'tool.smart-scan':    'اسمارٹ اسکین',
      'tool.img-to-pdf':    'تصویر سے PDF',
      'tool.pdf-to-jpg':    'PDF سے JPG',
      'tool.merge-pdf':     'PDF ضم کریں',
      'tool.split-pdf':     'PDF تقسیم کریں',
      'tool.compress-pdf':  'PDF کمپریس کریں',
      'tool.pdf-to-word':   'PDF سے Word',
      'tool.word-to-pdf':   'Word سے PDF',
      'tool.pdf-editor':    'PDF ایڈیٹر',
      'tool.fill-sign':     'بھریں اور دستخط',
      'tool.watermark':     'واٹر مارک',
      'tool.page-numbers':  'صفحہ نمبر',
      'tool.delete-pages':  'صفحات حذف کریں',
      'tool.ai-summarize':  'AI خلاصہ',
      'tool.img-compress':  'تصویر کمپریسر',
      'tool.ocr':           'OCR متن',
      'tool.age-calc':      'عمر کیلکولیٹر',
      'tool.bmi-calc':      'BMI کیلکولیٹر',
      'tool.discount-calc': 'ڈسکاؤنٹ کیلکولیٹر',
      'tool.inheritance':   'اسلامی وراثت',
      'desc.smart-scan':    'AI کنارہ شناخت',
      'desc.img-to-pdf':    'JPG/PNG → PDF',
      'desc.merge-pdf':     'PDFs کو ملائیں',
      'desc.split-pdf':     'حصوں میں تقسیم',
      'desc.pdf-editor':    'متن اور اشیاء میں ترمیم',
      'desc.img-compress':  'JPG، PNG، WEBP آپٹیمائزر',
      'desc.inheritance':   'وراثت انتقال اسلامی',
      'auth.signin.title':  'واپسی پر خوش آمدید',
      'auth.signin.sub':    'اپنا کام محفوظ کرنے کے لیے سائن ان کریں۔',
      'auth.google':        'Google سے جاری رکھیں',
      'auth.or':            'یا',
      'auth.email':         'ای میل',
      'auth.password':      'پاس ورڈ',
      'auth.btn.signin':    'سائن ان',
      'auth.no-account':    'اکاؤنٹ نہیں؟',
      'auth.signup.free':   'مفت سائن اپ',
      'auth.signup.title':  'اپنا اکاؤنٹ بنائیں',
      'auth.signup.sub':    'ہمیشہ مفت۔ کریڈٹ کارڈ کی ضرورت نہیں۔',
      'auth.username':      'صارف نام',
      'auth.fullname':      'پورا نام',
      'auth.gender':        'جنس',
      'auth.gender.select': '— جنس منتخب کریں —',
      'auth.gender.m':      'مرد',
      'auth.gender.f':      'عورت',
      'auth.gender.o':      'دیگر',
      'auth.gmail':         'Gmail / ای میل پتہ',
      'auth.phone':         'فون نمبر',
      'auth.optional':      'اختیاری',
      'auth.confirm-pw':    'پاس ورڈ تصدیق',
      'auth.create-btn':    'اکاؤنٹ بنائیں ←',
      'btn.download':       'ڈاؤن لوڈ',
      'btn.cancel':         'منسوخ',
      'btn.reset':          'دوبارہ ترتیب',
      'btn.process':        'پروسیس',
      'btn.upload':         'فائل اپ لوڈ',
      'btn.choose':         'فائل منتخب کریں',
      'btn.calculate':      'حساب لگائیں',
      'btn.copy':           'کاپی',
      'btn.print':          'پرنٹ',
      'btn.export':         'برآمد',
      'upload.drop':        'دستاویزات یہاں ڈراپ کریں یا اپ لوڈ کریں',
      'upload.hint':        'JPG، PNG، PDF سپورٹ کرتا ہے',
      'footer.rights':      '© 2026 PDFdukan۔ جملہ حقوق محفوظ ہیں۔',
      'section.recent':     'حالیہ دستاویزات',
      'section.why':        'CamMaster کیوں منتخب کریں؟',
      'section.faq':        'اکثر پوچھے جانے والے سوالات',
      'notif.none':         'کوئی اطلاعات نہیں',
      'notif.mark-read':    'سب پڑھے ہوئے نشان کریں',
    },

    /* ─────────── ARABIC ─────────── */
    ar: {
      'nav.home':           'الرئيسية',
      'nav.tools':          'الأدوات',
      'nav.blog':           'المدونة',
      'nav.legal':          'قانوني',
      'nav.about':          'من نحن',
      'nav.privacy':        'سياسة الخصوصية',
      'nav.terms':          'شروط الخدمة',
      'nav.cookies':        'سياسة الكوكيز',
      'header.signin':      'تسجيل الدخول',
      'header.signout':     'تسجيل الخروج',
      'header.account':     'الحساب',
      'header.search':      'ابحث عن الأدوات…',
      'hero.badge':         'ماسح ضوئي بالذكاء الاصطناعي',
      'hero.title':         'مسح وتحويل المستندات مع CamMaster',
      'hero.subtitle':      'ماسح ضوئي مجاني عبر الإنترنت من PDFdukan. كشف تلقائي للحواف، تحسين بالذكاء الاصطناعي، تحويل إلى PDF.',
      'hero.btn.scan':      'مسح ذكي',
      'hero.btn.import':    'استيراد الصور',
      'hero.btn.pdf':       'استيراد PDF',
      'hero.privacy':       '🔒 الخصوصية أولاً — تتم معالجة جميع الملفات في متصفحك',
      'tools.all':          'جميع الأدوات',
      'tools.browse':       'تصفح الكل ←',
      'tools.scanner':      '📷 الماسح',
      'tools.pdf':          '📄 محولات PDF',
      'tools.edit':         '✏️ تحرير وتوقيع',
      'tools.image':        '🖼️ الصور والمسح',
      'tools.calc':         '🔧 الحاسبات',
      'tool.smart-scan':    'مسح ذكي',
      'tool.img-to-pdf':    'صورة إلى PDF',
      'tool.pdf-to-jpg':    'PDF إلى JPG',
      'tool.merge-pdf':     'دمج PDF',
      'tool.split-pdf':     'تقسيم PDF',
      'tool.compress-pdf':  'ضغط PDF',
      'tool.pdf-to-word':   'PDF إلى Word',
      'tool.word-to-pdf':   'Word إلى PDF',
      'tool.pdf-editor':    'محرر PDF',
      'tool.fill-sign':     'ملء وتوقيع',
      'tool.watermark':     'علامة مائية',
      'tool.page-numbers':  'أرقام الصفحات',
      'tool.delete-pages':  'حذف الصفحات',
      'tool.ai-summarize':  'ملخص ذكاء اصطناعي',
      'tool.img-compress':  'ضاغط الصور',
      'tool.ocr':           'تعرف ضوئي',
      'tool.age-calc':      'حاسبة العمر',
      'tool.bmi-calc':      'حاسبة BMI',
      'tool.discount-calc': 'حاسبة الخصم',
      'tool.inheritance':   'حساب الميراث الإسلامي',
      'desc.inheritance':   'وراثة إسلامية — فرائض',
      'auth.signin.title':  'مرحباً بعودتك',
      'auth.signin.sub':    'سجّل الدخول لحفظ عملك.',
      'auth.google':        'المتابعة مع Google',
      'auth.or':            'أو',
      'auth.email':         'البريد الإلكتروني',
      'auth.password':      'كلمة المرور',
      'auth.btn.signin':    'تسجيل الدخول',
      'auth.no-account':    'ليس لديك حساب؟',
      'auth.signup.free':   'سجّل مجاناً',
      'auth.signup.title':  'أنشئ حسابك',
      'auth.signup.sub':    'مجاني إلى الأبد. لا يلزم بطاقة ائتمان.',
      'auth.username':      'اسم المستخدم',
      'auth.fullname':      'الاسم الكامل',
      'auth.gender':        'الجنس',
      'auth.gender.select': '— اختر الجنس —',
      'auth.gender.m':      'ذكر',
      'auth.gender.f':      'أنثى',
      'auth.gender.o':      'أفضل عدم الإفصاح',
      'auth.gmail':         'Gmail / البريد الإلكتروني',
      'auth.phone':         'رقم الهاتف',
      'auth.optional':      'اختياري',
      'auth.confirm-pw':    'تأكيد كلمة المرور',
      'auth.create-btn':    'إنشاء الحساب ←',
      'btn.download':       'تحميل',
      'btn.cancel':         'إلغاء',
      'btn.reset':          'إعادة تعيين',
      'btn.process':        'معالجة',
      'btn.calculate':      'احسب',
      'btn.copy':           'نسخ',
      'btn.print':          'طباعة',
      'btn.export':         'تصدير',
      'upload.drop':        'أفلت المستندات هنا أو انقر للرفع',
      'footer.rights':      '© 2026 PDFdukan. جميع الحقوق محفوظة.',
      'section.recent':     'المستندات الأخيرة',
      'section.faq':        'الأسئلة الشائعة',
      'notif.none':         'لا توجد إشعارات',
    },

    /* ─────────── SPANISH ─────────── */
    es: {
      'nav.home':           'Inicio',
      'nav.tools':          'Herramientas',
      'nav.blog':           'Blog',
      'nav.legal':          'Legal',
      'nav.about':          'Acerca de',
      'nav.privacy':        'Política de Privacidad',
      'nav.terms':          'Términos de Servicio',
      'header.signin':      'Iniciar Sesión',
      'header.signout':     'Cerrar Sesión',
      'header.search':      'Buscar herramientas…',
      'hero.badge':         'Escáner de documentos con IA',
      'hero.title':         'Escanea y Convierte Documentos con CamMaster',
      'hero.subtitle':      'Escáner de documentos gratuito en línea de PDFdukan. Detecta bordes automáticamente, mejora con IA, convierte a PDF.',
      'hero.btn.scan':      'Escaneo Inteligente',
      'hero.btn.import':    'Importar Imágenes',
      'hero.btn.pdf':       'Importar PDF',
      'hero.privacy':       '🔒 Privacidad primero — todos los archivos se procesan en tu navegador',
      'tools.all':          'Todas las Herramientas',
      'tools.browse':       'Ver Todas →',
      'tool.smart-scan':    'Escaneo Inteligente',
      'tool.img-to-pdf':    'Imagen a PDF',
      'tool.pdf-to-jpg':    'PDF a JPG',
      'tool.merge-pdf':     'Combinar PDF',
      'tool.split-pdf':     'Dividir PDF',
      'tool.compress-pdf':  'Comprimir PDF',
      'tool.pdf-to-word':   'PDF a Word',
      'tool.word-to-pdf':   'Word a PDF',
      'tool.pdf-editor':    'Editor PDF',
      'tool.fill-sign':     'Rellenar y Firmar',
      'tool.watermark':     'Marca de Agua',
      'tool.page-numbers':  'Números de Página',
      'tool.delete-pages':  'Eliminar Páginas',
      'tool.ai-summarize':  'Resumidor IA',
      'tool.img-compress':  'Compresor de Imágenes',
      'tool.ocr':           'OCR Texto',
      'tool.age-calc':      'Calculadora de Edad',
      'tool.bmi-calc':      'Calculadora IMC',
      'tool.discount-calc': 'Calculadora de Descuento',
      'tool.inheritance':   'Herencia Islámica',
      'auth.signin.title':  'Bienvenido de vuelta',
      'auth.signin.sub':    'Inicia sesión para guardar tu trabajo en todos los dispositivos.',
      'auth.google':        'Continuar con Google',
      'auth.or':            'o',
      'auth.email':         'Correo electrónico',
      'auth.password':      'Contraseña',
      'auth.btn.signin':    'Iniciar Sesión',
      'auth.no-account':    '¿Sin cuenta?',
      'auth.signup.free':   'Regístrate gratis',
      'auth.signup.title':  'Crea tu cuenta',
      'auth.username':      'Nombre de usuario',
      'auth.fullname':      'Nombre completo',
      'auth.gender':        'Género',
      'auth.gender.select': '— Seleccionar género —',
      'auth.gender.m':      'Masculino',
      'auth.gender.f':      'Femenino',
      'auth.gender.o':      'Otro / Prefiero no decir',
      'auth.gmail':         'Gmail / Correo electrónico',
      'auth.phone':         'Número de teléfono',
      'auth.optional':      'Opcional',
      'auth.confirm-pw':    'Confirmar contraseña',
      'auth.create-btn':    'Crear cuenta →',
      'btn.download':       'Descargar',
      'btn.cancel':         'Cancelar',
      'btn.reset':          'Reiniciar',
      'btn.process':        'Procesar',
      'btn.calculate':      'Calcular',
      'btn.copy':           'Copiar',
      'btn.print':          'Imprimir',
      'btn.export':         'Exportar',
      'upload.drop':        'Suelta documentos aquí o haz clic para subir',
      'footer.rights':      '© 2026 PDFdukan. Todos los derechos reservados.',
      'section.recent':     'Documentos Recientes',
      'section.faq':        'Preguntas Frecuentes',
      'notif.none':         'Sin notificaciones',
    },

    /* ─────────── FRENCH ─────────── */
    fr: {
      'nav.home':           'Accueil',
      'nav.tools':          'Outils',
      'nav.blog':           'Blog',
      'nav.legal':          'Légal',
      'nav.about':          'À propos',
      'nav.privacy':        'Politique de confidentialité',
      'nav.terms':          'Conditions d\'utilisation',
      'header.signin':      'Se connecter',
      'header.signout':     'Se déconnecter',
      'header.search':      'Rechercher des outils…',
      'hero.badge':         'Scanner de documents IA',
      'hero.title':         'Scannez et convertissez des documents avec CamMaster',
      'hero.subtitle':      'Scanner de documents gratuit en ligne par PDFdukan. Détection automatique des bords, amélioration par IA, conversion en PDF.',
      'hero.btn.scan':      'Scan intelligent',
      'hero.btn.import':    'Importer des images',
      'hero.btn.pdf':       'Importer PDF',
      'hero.privacy':       '🔒 Confidentialité d\'abord — tous les fichiers traités localement',
      'tools.all':          'Tous les outils',
      'tools.browse':       'Voir tout →',
      'tool.smart-scan':    'Scan intelligent',
      'tool.img-to-pdf':    'Image en PDF',
      'tool.pdf-to-jpg':    'PDF en JPG',
      'tool.merge-pdf':     'Fusionner PDF',
      'tool.split-pdf':     'Diviser PDF',
      'tool.compress-pdf':  'Compresser PDF',
      'tool.pdf-to-word':   'PDF en Word',
      'tool.word-to-pdf':   'Word en PDF',
      'tool.pdf-editor':    'Éditeur PDF',
      'tool.fill-sign':     'Remplir et signer',
      'tool.watermark':     'Filigrane',
      'tool.img-compress':  'Compresseur d\'images',
      'tool.age-calc':      'Calculateur d\'âge',
      'tool.bmi-calc':      'Calculateur IMC',
      'tool.discount-calc': 'Calculateur de remise',
      'tool.inheritance':   'Héritage islamique',
      'auth.signin.title':  'Bon retour',
      'auth.google':        'Continuer avec Google',
      'auth.email':         'E-mail',
      'auth.password':      'Mot de passe',
      'auth.btn.signin':    'Se connecter',
      'auth.username':      'Nom d\'utilisateur',
      'auth.fullname':      'Nom complet',
      'auth.gender.m':      'Homme',
      'auth.gender.f':      'Femme',
      'auth.gmail':         'Gmail / Adresse e-mail',
      'auth.phone':         'Numéro de téléphone',
      'auth.optional':      'Facultatif',
      'btn.download':       'Télécharger',
      'btn.cancel':         'Annuler',
      'btn.calculate':      'Calculer',
      'btn.copy':           'Copier',
      'upload.drop':        'Déposez des documents ici ou cliquez pour charger',
      'footer.rights':      '© 2026 PDFdukan. Tous droits réservés.',
      'section.recent':     'Documents récents',
      'section.faq':        'Questions fréquentes',
      'notif.none':         'Aucune notification',
    },

    /* ─────────── GERMAN ─────────── */
    de: {
      'nav.home':           'Startseite',
      'nav.tools':          'Werkzeuge',
      'nav.blog':           'Blog',
      'nav.legal':          'Rechtliches',
      'nav.about':          'Über uns',
      'nav.privacy':        'Datenschutzrichtlinie',
      'nav.terms':          'Nutzungsbedingungen',
      'header.signin':      'Anmelden',
      'header.signout':     'Abmelden',
      'header.search':      'Werkzeuge suchen…',
      'hero.badge':         'KI-gestützter Dokumentenscanner',
      'hero.title':         'Dokumente mit CamMaster scannen und konvertieren',
      'hero.subtitle':      'Kostenloser Online-Dokumentenscanner von PDFdukan. Kanten automatisch erkennen, mit KI verbessern, in PDF konvertieren.',
      'hero.btn.scan':      'Intelligenter Scan',
      'hero.btn.import':    'Bilder importieren',
      'hero.btn.pdf':       'PDF importieren',
      'hero.privacy':       '🔒 Datenschutz zuerst — alle Dateien lokal verarbeitet',
      'tools.all':          'Alle Werkzeuge',
      'tools.browse':       'Alle anzeigen →',
      'tool.smart-scan':    'Intelligenter Scan',
      'tool.img-to-pdf':    'Bild zu PDF',
      'tool.pdf-to-jpg':    'PDF zu JPG',
      'tool.merge-pdf':     'PDFs zusammenführen',
      'tool.split-pdf':     'PDF aufteilen',
      'tool.compress-pdf':  'PDF komprimieren',
      'tool.pdf-to-word':   'PDF zu Word',
      'tool.word-to-pdf':   'Word zu PDF',
      'tool.pdf-editor':    'PDF-Editor',
      'tool.fill-sign':     'Ausfüllen und unterschreiben',
      'tool.img-compress':  'Bildkompressor',
      'tool.age-calc':      'Altersrechner',
      'tool.bmi-calc':      'BMI-Rechner',
      'tool.discount-calc': 'Rabattrechner',
      'tool.inheritance':   'Islamisches Erbe',
      'auth.signin.title':  'Willkommen zurück',
      'auth.google':        'Mit Google fortfahren',
      'auth.email':         'E-Mail',
      'auth.password':      'Passwort',
      'auth.btn.signin':    'Anmelden',
      'auth.username':      'Benutzername',
      'auth.fullname':      'Vollständiger Name',
      'auth.gender.m':      'Männlich',
      'auth.gender.f':      'Weiblich',
      'auth.gmail':         'Gmail / E-Mail-Adresse',
      'auth.phone':         'Telefonnummer',
      'auth.optional':      'Optional',
      'btn.download':       'Herunterladen',
      'btn.cancel':         'Abbrechen',
      'btn.calculate':      'Berechnen',
      'upload.drop':        'Dokumente hier ablegen oder klicken',
      'footer.rights':      '© 2026 PDFdukan. Alle Rechte vorbehalten.',
      'section.recent':     'Letzte Dokumente',
      'section.faq':        'Häufig gestellte Fragen',
      'notif.none':         'Keine Benachrichtigungen',
    },

    /* ─────────── HINDI ─────────── */
    hi: {
      'nav.home':           'होम',
      'nav.tools':          'उपकरण',
      'nav.blog':           'ब्लॉग',
      'nav.legal':          'कानूनी',
      'nav.about':          'हमारे बारे में',
      'nav.privacy':        'गोपनीयता नीति',
      'nav.terms':          'सेवा की शर्तें',
      'header.signin':      'साइन इन',
      'header.signout':     'साइन आउट',
      'header.search':      'उपकरण खोजें…',
      'hero.badge':         'AI-संचालित दस्तावेज़ स्कैनर',
      'hero.title':         'CamMaster से दस्तावेज़ स्कैन और कन्वर्ट करें',
      'hero.subtitle':      'PDFdukan का मुफ़्त ऑनलाइन दस्तावेज़ स्कैनर। स्वचालित किनारा पहचान, AI से सुधार, PDF में कन्वर्ट।',
      'hero.btn.scan':      'स्मार्ट स्कैन',
      'hero.btn.import':    'छवियाँ आयात करें',
      'hero.btn.pdf':       'PDF आयात करें',
      'hero.privacy':       '🔒 गोपनीयता पहले — सभी फ़ाइलें आपके ब्राउज़र में प्रोसेस होती हैं',
      'tools.all':          'सभी उपकरण',
      'tools.browse':       'सभी देखें →',
      'tool.smart-scan':    'स्मार्ट स्कैन',
      'tool.img-to-pdf':    'छवि से PDF',
      'tool.pdf-to-jpg':    'PDF से JPG',
      'tool.merge-pdf':     'PDF मर्ज करें',
      'tool.split-pdf':     'PDF विभाजित करें',
      'tool.compress-pdf':  'PDF कंप्रेस करें',
      'tool.pdf-editor':    'PDF संपादक',
      'tool.img-compress':  'छवि कंप्रेसर',
      'tool.age-calc':      'आयु कैलकुलेटर',
      'tool.bmi-calc':      'BMI कैलकुलेटर',
      'tool.discount-calc': 'छूट कैलकुलेटर',
      'tool.inheritance':   'इस्लामी विरासत',
      'auth.signin.title':  'वापसी पर स्वागत है',
      'auth.google':        'Google से जारी रखें',
      'auth.email':         'ईमेल',
      'auth.password':      'पासवर्ड',
      'auth.btn.signin':    'साइन इन',
      'auth.username':      'उपयोगकर्ता नाम',
      'auth.fullname':      'पूरा नाम',
      'auth.gender.m':      'पुरुष',
      'auth.gender.f':      'महिला',
      'auth.phone':         'फ़ोन नंबर',
      'auth.optional':      'वैकल्पिक',
      'btn.download':       'डाउनलोड',
      'btn.cancel':         'रद्द करें',
      'btn.calculate':      'गणना करें',
      'upload.drop':        'यहाँ दस्तावेज़ छोड़ें या अपलोड करें',
      'footer.rights':      '© 2026 PDFdukan. सर्वाधिकार सुरक्षित।',
      'section.recent':     'हाल के दस्तावेज़',
      'section.faq':        'अक्सर पूछे जाने वाले प्रश्न',
      'notif.none':         'कोई सूचना नहीं',
    },

    /* ─────────── TURKISH ─────────── */
    tr: {
      'nav.home':           'Ana Sayfa',
      'nav.tools':          'Araçlar',
      'nav.blog':           'Blog',
      'nav.legal':          'Hukuki',
      'nav.about':          'Hakkımızda',
      'nav.privacy':        'Gizlilik Politikası',
      'nav.terms':          'Kullanım Şartları',
      'header.signin':      'Giriş Yap',
      'header.signout':     'Çıkış Yap',
      'header.search':      'Araçları ara…',
      'hero.badge':         'Yapay Zeka Belge Tarayıcı',
      'hero.title':         'CamMaster ile Belgeleri Tara ve Dönüştür',
      'hero.subtitle':      'PDFdukan\'dan ücretsiz çevrimiçi belge tarayıcı. Kenarları otomatik algıla, AI ile geliştir, PDF\'e dönüştür.',
      'hero.btn.scan':      'Akıllı Tara',
      'hero.btn.import':    'Resim İçe Aktar',
      'hero.btn.pdf':       'PDF İçe Aktar',
      'hero.privacy':       '🔒 Önce gizlilik — tüm dosyalar tarayıcınızda işlenir',
      'tools.all':          'Tüm Araçlar',
      'tools.browse':       'Tümünü Gör →',
      'tool.smart-scan':    'Akıllı Tara',
      'tool.img-to-pdf':    'Resim\'den PDF\'e',
      'tool.pdf-to-jpg':    'PDF\'den JPG\'ye',
      'tool.merge-pdf':     'PDF Birleştir',
      'tool.split-pdf':     'PDF Böl',
      'tool.compress-pdf':  'PDF Sıkıştır',
      'tool.pdf-to-word':   'PDF\'den Word\'e',
      'tool.word-to-pdf':   'Word\'den PDF\'e',
      'tool.pdf-editor':    'PDF Düzenleyici',
      'tool.img-compress':  'Resim Sıkıştırıcı',
      'tool.age-calc':      'Yaş Hesaplayıcı',
      'tool.bmi-calc':      'VKİ Hesaplayıcı',
      'tool.discount-calc': 'İndirim Hesaplayıcı',
      'tool.inheritance':   'İslami Miras',
      'auth.signin.title':  'Tekrar hoşgeldiniz',
      'auth.google':        'Google ile devam et',
      'auth.email':         'E-posta',
      'auth.password':      'Şifre',
      'auth.btn.signin':    'Giriş Yap',
      'auth.username':      'Kullanıcı adı',
      'auth.fullname':      'Tam ad',
      'auth.gender.m':      'Erkek',
      'auth.gender.f':      'Kadın',
      'auth.phone':         'Telefon numarası',
      'auth.optional':      'İsteğe bağlı',
      'btn.download':       'İndir',
      'btn.cancel':         'İptal',
      'btn.calculate':      'Hesapla',
      'upload.drop':        'Belgeleri buraya bırakın veya tıklayın',
      'footer.rights':      '© 2026 PDFdukan. Tüm hakları saklıdır.',
      'section.recent':     'Son Belgeler',
      'section.faq':        'Sık Sorulan Sorular',
      'notif.none':         'Bildirim yok',
    },
  };

  /* ── Fill missing translations for all non-EN languages ─────── */
  const _SUPPLEMENT = {
    ur: {
      'nav.cookies':'کوکیز پالیسی','mnav.pdf-tools':'PDF ٹولز','mnav.edit-sign':'ترمیم اور دستخط',
      'mnav.image-scan':'تصویر اور اسکین','mnav.calc':'کیلکولیٹر','mnav.more':'مزید',
      'tool.pdf-to-ppt':'PDF سے PowerPoint','tool.ppt-to-pdf':'PowerPoint سے PDF',
      'tool.pdf-to-excel':'PDF سے Excel','tool.excel-to-pdf':'Excel سے PDF','tool.html-to-pdf':'HTML سے PDF',
      'desc.pdf-to-jpg':'تمام صفحات نکالیں','desc.compress-pdf':'PDF سائز چھوٹا کریں',
      'desc.pdf-to-word':'.doc فائل میں متن','desc.word-to-pdf':'DOCX → PDF',
      'desc.fill-sign':'ڈیجیٹل دستخط','desc.watermark':'تمام صفحات پر مہر',
      'desc.ocr':'تصویر سے متن نکالیں','desc.age-calc':'عمر حقیقی وقت میں',
      'desc.bmi-calc':'میٹرک اور امپیریل','desc.discount-calc':'قیمت، % اور ٹیکس',
      'desc.pdf-to-ppt':'PDF سے سلائیڈز','desc.ppt-to-pdf':'PPTX → PDF',
      'desc.pdf-to-excel':'ٹیبلز نکالیں','desc.excel-to-pdf':'XLSX → PDF',
      'desc.html-to-pdf':'URL یا HTML سے PDF','desc.page-numbers':'خودکار صفحہ نمبر',
      'desc.delete-pages':'مخصوص صفحات ہٹائیں','desc.ai-summarize':'فوری خلاصہ',
      'auth.pw.min':'کم از کم 8 حروف','auth.google.signup':'Google سے سائن اپ','auth.or.below':'یا نیچے بھریں',
      'auth.have-account':'پہلے سے ممبر ہیں؟','auth.go-signin':'سائن ان کریں','auth.signup':'سائن اپ',
      'footer.brand':'CamMaster کا گھر — بہترین مفت آن لائن دستاویز اسکینر۔',
      'footer.scanner':'اسکینر','footer.pdf-tools':'PDF ٹولز','footer.company':'کمپنی',
      'section.how':'CamMaster سے دستاویزات کیسے اسکین کریں','section.why':'PDFdukan کا CamMaster کیوں؟',
      'toast.lang':'زبان تبدیل ہوئی','toast.theme.dark':'ڈارک موڈ','toast.theme.light':'لائٹ موڈ',
      'header.account':'اکاؤنٹ',
      'desc.smart-scan':'AI کنارہ شناخت','desc.img-to-pdf':'JPG/PNG → PDF',
      'desc.merge-pdf':'PDFs یکجا کریں','desc.split-pdf':'حصوں میں تقسیم',
      'desc.pdf-editor':'متن اور اشیاء ترمیم','desc.img-compress':'JPG, PNG, WEBP',
      'btn.upload':'فائل اپلوڈ','btn.choose':'فائل منتخب کریں',
      'upload.hint':'JPG, PNG, PDF — ایک ساتھ متعدد فائلیں','notif.mark-read':'سب پڑھا ہوا',
    },
    ar: {
      'nav.cookies':'سياسة الكوكيز','mnav.pdf-tools':'أدوات PDF','mnav.edit-sign':'تحرير وتوقيع',
      'mnav.image-scan':'الصور والمسح','mnav.calc':'الحاسبات','mnav.more':'المزيد',
      'tool.pdf-to-ppt':'PDF إلى PowerPoint','tool.ppt-to-pdf':'PowerPoint إلى PDF',
      'tool.pdf-to-excel':'PDF إلى Excel','tool.excel-to-pdf':'Excel إلى PDF','tool.html-to-pdf':'HTML إلى PDF',
      'desc.pdf-to-jpg':'استخراج جميع الصفحات','desc.compress-pdf':'تصغير حجم PDF',
      'desc.pdf-to-word':'نص إلى ملف .doc','desc.word-to-pdf':'DOCX → PDF',
      'desc.fill-sign':'التوقيعات الرقمية','desc.watermark':'ختم جميع الصفحات',
      'desc.ocr':'صورة إلى نص','desc.age-calc':'العمر الدقيق','desc.bmi-calc':'متري وإمبريالي',
      'desc.discount-calc':'السعر والنسبة والضريبة','desc.pdf-to-ppt':'PDF إلى شرائح',
      'desc.ppt-to-pdf':'PPTX → PDF','desc.pdf-to-excel':'استخراج الجداول',
      'desc.excel-to-pdf':'XLSX → PDF','desc.html-to-pdf':'URL أو HTML إلى PDF',
      'desc.page-numbers':'ترقيم تلقائي','desc.delete-pages':'حذف صفحات محددة','desc.ai-summarize':'ملخص فوري',
      'auth.pw.min':'8 أحرف على الأقل','auth.google.signup':'التسجيل مع Google','auth.or.below':'أو أملأ أدناه',
      'auth.have-account':'عضو بالفعل؟','auth.go-signin':'تسجيل الدخول','auth.signup':'تسجيل','auth.signup.sub':'مجاني للأبد.',
      'btn.upload':'رفع ملف','btn.choose':'اختر ملف','btn.reset':'إعادة تعيين',
      'btn.process':'معالجة','btn.print':'طباعة','btn.export':'تصدير',
      'upload.hint':'يدعم JPG، PNG، PDF','notif.mark-read':'تعليم الكل كمقروء',
      'footer.brand':'منزل CamMaster — أفضل ماسح ضوئي مجاني.','footer.scanner':'الماسح',
      'footer.pdf-tools':'أدوات PDF','footer.company':'الشركة',
      'section.how':'كيفية مسح المستندات مع CamMaster','section.why':'لماذا تختار CamMaster؟',
      'toast.lang':'تم تغيير اللغة','toast.theme.dark':'الوضع الداكن','toast.theme.light':'الوضع الفاتح',
      'header.account':'الحساب',
      'tools.scanner':'📷 الماسح الضوئي','tools.pdf':'📄 محولات PDF','tools.edit':'✏️ تحرير وتوقيع',
      'tools.image':'🖼️ الصور والمسح','tools.calc':'🔧 الحاسبات',
      'desc.smart-scan':'كشف حواف بالذكاء الاصطناعي','desc.img-to-pdf':'JPG/PNG → PDF',
      'desc.merge-pdf':'دمج ملفات PDF','desc.split-pdf':'تقسيم إلى أجزاء',
      'desc.pdf-editor':'تعديل النص والكائنات','desc.img-compress':'JPG, PNG, WEBP',
    },
    es: {
      'nav.cookies':'Política de Cookies','mnav.pdf-tools':'Herramientas PDF','mnav.edit-sign':'Editar y Firmar',
      'mnav.image-scan':'Imagen y Escaneo','mnav.calc':'Calculadoras','mnav.more':'Más',
      'tools.scanner':'📷 Escáner','tools.pdf':'📄 Conversores PDF','tools.edit':'✏️ Editar y Firmar',
      'tools.image':'🖼️ Imagen y Escaneo','tools.calc':'🔧 Calculadoras',
      'tool.pdf-to-ppt':'PDF a PowerPoint','tool.ppt-to-pdf':'PowerPoint a PDF',
      'tool.pdf-to-excel':'PDF a Excel','tool.excel-to-pdf':'Excel a PDF','tool.html-to-pdf':'HTML a PDF',
      'tool.page-numbers':'Números de Página','tool.delete-pages':'Eliminar Páginas',
      'desc.smart-scan':'Detección IA de bordes','desc.img-to-pdf':'JPG/PNG → PDF',
      'desc.pdf-to-jpg':'Extraer todas las páginas','desc.merge-pdf':'Combinar PDFs',
      'desc.split-pdf':'Dividir en partes','desc.compress-pdf':'Reducir tamaño PDF',
      'desc.pdf-to-word':'Texto a .doc','desc.word-to-pdf':'DOCX → PDF',
      'desc.pdf-editor':'Editar texto y objetos','desc.fill-sign':'Firmas digitales',
      'desc.watermark':'Estampar todas las páginas','desc.img-compress':'JPG, PNG, WEBP',
      'desc.ocr':'Imagen a texto editable','desc.age-calc':'Edad exacta, en tiempo real',
      'desc.bmi-calc':'Métrico e imperial','desc.discount-calc':'Precio, % e impuesto',
      'desc.inheritance':'Herencia islámica','desc.pdf-to-ppt':'PDF a diapositivas',
      'desc.ppt-to-pdf':'PPTX → PDF','desc.pdf-to-excel':'Extraer tablas',
      'desc.excel-to-pdf':'XLSX → PDF','desc.html-to-pdf':'URL o HTML a PDF',
      'desc.page-numbers':'Numerar automáticamente','desc.delete-pages':'Eliminar páginas específicas',
      'desc.ai-summarize':'Resumen instantáneo',
      'auth.signup.sub':'Gratis para siempre. Sin tarjeta de crédito.',
      'auth.google.signup':'Registrarse con Google','auth.or.below':'o complete abajo',
      'auth.pw.min':'Mín. 8 caracteres','auth.have-account':'¿Ya eres miembro?','auth.go-signin':'Iniciar Sesión','auth.signup':'Registrarse',
      'btn.upload':'Subir archivo','btn.choose':'Elegir archivo','btn.print':'Imprimir','btn.export':'Exportar',
      'upload.hint':'Compatible con JPG, PNG, PDF','notif.mark-read':'Marcar todo como leído',
      'footer.brand':'Hogar de CamMaster — el mejor escáner de documentos en línea gratuito.',
      'footer.scanner':'Escáner','footer.pdf-tools':'Herramientas PDF','footer.company':'Empresa',
      'section.how':'Cómo escanear documentos con CamMaster','section.why':'¿Por qué elegir CamMaster?',
      'toast.lang':'Idioma cambiado','toast.theme.dark':'Modo oscuro','toast.theme.light':'Modo claro',
      'header.account':'Cuenta',
    },
    fr: {
      'nav.cookies':'Politique de cookies','mnav.pdf-tools':'Outils PDF','mnav.edit-sign':'Éditer et Signer',
      'mnav.image-scan':'Image et Scan','mnav.calc':'Calculateurs','mnav.more':'Plus',
      'tools.scanner':'📷 Scanner','tools.pdf':'📄 Convertisseurs PDF','tools.edit':'✏️ Éditer et Signer',
      'tools.image':'🖼️ Image et Scan','tools.calc':'🔧 Calculateurs',
      'tool.page-numbers':'Numéros de page','tool.delete-pages':'Supprimer des pages',
      'tool.ai-summarize':'Résumeur IA','tool.ocr':'OCR Texte','tool.watermark':'Filigrane',
      'tool.pdf-to-ppt':'PDF en PowerPoint','tool.ppt-to-pdf':'PowerPoint en PDF',
      'tool.pdf-to-excel':'PDF en Excel','tool.excel-to-pdf':'Excel en PDF','tool.html-to-pdf':'HTML en PDF',
      'desc.smart-scan':'Détection IA des bords','desc.img-to-pdf':'JPG/PNG → PDF',
      'desc.pdf-to-jpg':'Extraire toutes les pages','desc.merge-pdf':'Combiner des PDFs',
      'desc.split-pdf':'Diviser en parties','desc.compress-pdf':'Réduire la taille',
      'desc.pdf-to-word':'Texte en .doc','desc.word-to-pdf':'DOCX → PDF',
      'desc.pdf-editor':'Modifier texte et objets','desc.fill-sign':'Signatures numériques',
      'desc.watermark':'Estamper toutes les pages','desc.img-compress':'JPG, PNG, WEBP',
      'desc.ocr':'Image en texte éditable','desc.age-calc':'Âge exact en temps réel',
      'desc.bmi-calc':'Métrique et impérial','desc.discount-calc':'Prix, % et taxe',
      'desc.inheritance':'Héritage islamique','desc.pdf-to-ppt':'PDF en diapositives',
      'desc.ppt-to-pdf':'PPTX → PDF','desc.pdf-to-excel':'Extraire les tableaux',
      'desc.excel-to-pdf':'XLSX → PDF','desc.html-to-pdf':'URL ou HTML en PDF',
      'desc.page-numbers':'Numérotation automatique','desc.delete-pages':'Supprimer des pages',
      'desc.ai-summarize':'Résumé instantané',
      'auth.signin.sub':'Connectez-vous pour sauvegarder votre travail.',
      'auth.no-account':'Pas de compte ?','auth.signup.free':'Inscrivez-vous gratuitement',
      'auth.signup.title':'Créez votre compte','auth.signup.sub':'Gratuit pour toujours.',
      'auth.google.signup':'S\'inscrire avec Google','auth.or.below':'ou remplissez ci-dessous',
      'auth.gender':'Genre','auth.gender.select':'— Choisir le genre —','auth.gender.o':'Autre',
      'auth.pw.min':'Min. 8 caractères','auth.confirm-pw':'Confirmer le mot de passe',
      'auth.create-btn':'Créer le compte →','auth.have-account':'Déjà membre ?','auth.go-signin':'Se connecter','auth.signup':'S\'inscrire',
      'btn.reset':'Réinitialiser','btn.process':'Traiter','btn.upload':'Charger un fichier',
      'btn.choose':'Choisir un fichier','btn.print':'Imprimer','btn.export':'Exporter',
      'upload.hint':'Prend en charge JPG, PNG, PDF','notif.mark-read':'Tout marquer lu',
      'footer.brand':'CamMaster — le meilleur scanner de documents en ligne gratuit.',
      'footer.scanner':'Scanner','footer.pdf-tools':'Outils PDF','footer.company':'Entreprise',
      'section.how':'Comment numériser des documents avec CamMaster','section.why':'Pourquoi choisir CamMaster ?',
      'toast.lang':'Langue modifiée','toast.theme.dark':'Mode sombre','toast.theme.light':'Mode clair',
      'header.account':'Compte','auth.or':'ou',
    },
    de: {
      'nav.cookies':'Cookie-Richtlinie','mnav.pdf-tools':'PDF Werkzeuge','mnav.edit-sign':'Bearbeiten & Signieren',
      'mnav.image-scan':'Bild & Scan','mnav.calc':'Rechner','mnav.more':'Mehr',
      'tools.scanner':'📷 Scanner','tools.pdf':'📄 PDF-Konverter','tools.edit':'✏️ Bearbeiten & Signieren',
      'tools.image':'🖼️ Bild & Scan','tools.calc':'🔧 Rechner',
      'tool.watermark':'Wasserzeichen','tool.page-numbers':'Seitennummern','tool.delete-pages':'Seiten löschen',
      'tool.ai-summarize':'KI-Zusammenfasser','tool.ocr':'OCR Text','tool.fill-sign':'Ausfüllen & Unterschreiben',
      'tool.pdf-to-ppt':'PDF zu PowerPoint','tool.ppt-to-pdf':'PowerPoint zu PDF',
      'tool.pdf-to-excel':'PDF zu Excel','tool.excel-to-pdf':'Excel zu PDF','tool.html-to-pdf':'HTML zu PDF',
      'desc.smart-scan':'KI-Kantenerkennung','desc.img-to-pdf':'JPG/PNG → PDF',
      'desc.pdf-to-jpg':'Alle Seiten extrahieren','desc.merge-pdf':'PDFs kombinieren',
      'desc.split-pdf':'In Teile aufteilen','desc.compress-pdf':'PDF-Größe reduzieren',
      'desc.pdf-to-word':'Text in .doc','desc.word-to-pdf':'DOCX → PDF',
      'desc.pdf-editor':'Text & Objekte bearbeiten','desc.fill-sign':'Digitale Unterschriften',
      'desc.watermark':'Alle Seiten stempeln','desc.img-compress':'JPG, PNG, WEBP',
      'desc.ocr':'Bild zu bearbeitbarem Text','desc.age-calc':'Exaktes Alter, Echtzeit',
      'desc.bmi-calc':'Metrisch & imperial','desc.discount-calc':'Preis, % & Steuer',
      'desc.inheritance':'Islamisches Erbe','desc.pdf-to-ppt':'PDF zu Folien',
      'desc.ppt-to-pdf':'PPTX → PDF','desc.pdf-to-excel':'Tabellen extrahieren',
      'desc.excel-to-pdf':'XLSX → PDF','desc.html-to-pdf':'URL oder HTML zu PDF',
      'desc.page-numbers':'Automatische Nummerierung','desc.delete-pages':'Bestimmte Seiten entfernen',
      'desc.ai-summarize':'Sofortige Zusammenfassung',
      'auth.signin.sub':'Anmelden um Ihre Arbeit zu speichern.',
      'auth.no-account':'Kein Konto?','auth.signup.free':'Kostenlos registrieren',
      'auth.signup.title':'Konto erstellen','auth.signup.sub':'Für immer kostenlos.',
      'auth.google.signup':'Mit Google registrieren','auth.or.below':'oder unten ausfüllen',
      'auth.gender':'Geschlecht','auth.gender.select':'— Geschlecht wählen —','auth.gender.o':'Andere',
      'auth.pw.min':'Mind. 8 Zeichen','auth.confirm-pw':'Passwort bestätigen',
      'auth.create-btn':'Konto erstellen →','auth.have-account':'Schon Mitglied?','auth.go-signin':'Anmelden','auth.signup':'Registrieren',
      'btn.reset':'Zurücksetzen','btn.process':'Verarbeiten','btn.upload':'Datei hochladen',
      'btn.choose':'Datei wählen','btn.print':'Drucken','btn.export':'Exportieren','btn.copy':'Kopieren',
      'upload.hint':'Unterstützt JPG, PNG, PDF','notif.mark-read':'Alle als gelesen markieren',
      'footer.brand':'CamMaster — der beste kostenlose Dokumentenscanner.','footer.scanner':'Scanner',
      'footer.pdf-tools':'PDF Werkzeuge','footer.company':'Unternehmen',
      'section.how':'Dokumente mit CamMaster scannen','section.why':'Warum CamMaster wählen?',
      'toast.lang':'Sprache geändert','toast.theme.dark':'Dunkler Modus','toast.theme.light':'Heller Modus',
      'header.account':'Konto','auth.or':'oder',
    },
    hi: {
      'nav.cookies':'कुकी नीति','mnav.pdf-tools':'PDF उपकरण','mnav.edit-sign':'संपादित करें और हस्ताक्षर',
      'mnav.image-scan':'छवि और स्कैन','mnav.calc':'कैलकुलेटर','mnav.more':'और',
      'tools.scanner':'📷 स्कैनर','tools.pdf':'📄 PDF कन्वर्टर','tools.edit':'✏️ संपादित करें और हस्ताक्षर',
      'tools.image':'🖼️ छवि और स्कैन','tools.calc':'🔧 कैलकुलेटर',
      'tool.pdf-to-word':'PDF से Word','tool.word-to-pdf':'Word से PDF',
      'tool.fill-sign':'भरें और हस्ताक्षर','tool.watermark':'वॉटरमार्क',
      'tool.page-numbers':'पृष्ठ संख्या','tool.delete-pages':'पृष्ठ हटाएं',
      'tool.ai-summarize':'AI सारांश','tool.ocr':'OCR पाठ',
      'tool.pdf-to-ppt':'PDF से PowerPoint','tool.ppt-to-pdf':'PowerPoint से PDF',
      'tool.pdf-to-excel':'PDF से Excel','tool.excel-to-pdf':'Excel से PDF','tool.html-to-pdf':'HTML से PDF',
      'desc.smart-scan':'AI किनारा पहचान','desc.img-to-pdf':'JPG/PNG → PDF',
      'desc.pdf-to-jpg':'सभी पृष्ठ निकालें','desc.merge-pdf':'PDFs जोड़ें',
      'desc.split-pdf':'भागों में विभाजित','desc.compress-pdf':'PDF आकार कम करें',
      'desc.pdf-to-word':'पाठ .doc फ़ाइल में','desc.word-to-pdf':'DOCX → PDF',
      'desc.pdf-editor':'पाठ और ऑब्जेक्ट संपादित','desc.fill-sign':'डिजिटल हस्ताक्षर',
      'desc.watermark':'सभी पृष्ठों पर मुहर','desc.img-compress':'JPG, PNG, WEBP',
      'desc.ocr':'छवि से पाठ','desc.age-calc':'सटीक आयु, वास्तविक समय',
      'desc.bmi-calc':'मीट्रिक और इम्पीरियल','desc.discount-calc':'मूल्य, % और कर',
      'desc.inheritance':'इस्लामी विरासत','desc.pdf-to-ppt':'PDF से स्लाइड',
      'desc.ppt-to-pdf':'PPTX → PDF','desc.pdf-to-excel':'तालिकाएँ निकालें',
      'desc.excel-to-pdf':'XLSX → PDF','desc.html-to-pdf':'URL या HTML से PDF',
      'desc.page-numbers':'स्वचालित अंकन','desc.delete-pages':'विशिष्ट पृष्ठ हटाएं',
      'desc.ai-summarize':'तत्काल सारांश',
      'auth.signin.sub':'अपने काम को सेव करने के लिए साइन इन करें।',
      'auth.no-account':'कोई खाता नहीं?','auth.signup.free':'मुफ़्त साइन अप',
      'auth.signup.title':'अपना खाता बनाएं','auth.signup.sub':'हमेशा मुफ़्त।',
      'auth.google.signup':'Google से साइन अप','auth.or.below':'या नीचे भरें',
      'auth.gender':'लिंग','auth.gender.select':'— लिंग चुनें —','auth.gender.o':'अन्य',
      'auth.pw.min':'न्यूनतम 8 अक्षर','auth.confirm-pw':'पासवर्ड की पुष्टि',
      'auth.create-btn':'खाता बनाएं →','auth.have-account':'पहले से सदस्य?','auth.go-signin':'साइन इन','auth.signup':'साइन अप',
      'btn.reset':'रीसेट','btn.process':'प्रोसेस','btn.upload':'फ़ाइल अपलोड',
      'btn.choose':'फ़ाइल चुनें','btn.print':'प्रिंट','btn.export':'एक्सपोर्ट','btn.copy':'कॉपी',
      'upload.hint':'JPG, PNG, PDF समर्थित','notif.mark-read':'सभी को पढ़ा हुआ करें',
      'footer.brand':'CamMaster — सर्वश्रेष्ठ मुफ़्त दस्तावेज़ स्कैनर।','footer.scanner':'स्कैनर',
      'footer.pdf-tools':'PDF उपकरण','footer.company':'कंपनी',
      'section.how':'CamMaster से दस्तावेज़ कैसे स्कैन करें','section.why':'CamMaster क्यों चुनें?',
      'toast.lang':'भाषा बदली गई','toast.theme.dark':'डार्क मोड','toast.theme.light':'लाइट मोड',
      'header.account':'खाता','auth.or':'या','auth.gmail':'Gmail / ईमेल पता',
    },
    tr: {
      'nav.cookies':'Çerez Politikası','mnav.pdf-tools':'PDF Araçları','mnav.edit-sign':'Düzenle ve İmzala',
      'mnav.image-scan':'Resim ve Tarama','mnav.calc':'Hesaplayıcılar','mnav.more':'Daha Fazla',
      'tools.scanner':'📷 Tarayıcı','tools.pdf':'📄 PDF Dönüştürücüler','tools.edit':'✏️ Düzenle ve İmzala',
      'tools.image':'🖼️ Resim ve Tarama','tools.calc':'🔧 Hesaplayıcılar',
      'tool.fill-sign':'Doldur ve İmzala','tool.watermark':'Filigran',
      'tool.page-numbers':'Sayfa Numaraları','tool.delete-pages':'Sayfaları Sil',
      'tool.ai-summarize':'AI Özetleyici','tool.ocr':'OCR Metin',
      'tool.pdf-to-ppt':'PDF\'den PowerPoint\'e','tool.ppt-to-pdf':'PowerPoint\'den PDF\'e',
      'tool.pdf-to-excel':'PDF\'den Excel\'e','tool.excel-to-pdf':'Excel\'den PDF\'e','tool.html-to-pdf':'HTML\'den PDF\'e',
      'desc.smart-scan':'AI kenar algılama','desc.img-to-pdf':'JPG/PNG → PDF',
      'desc.pdf-to-jpg':'Tüm sayfaları çıkar','desc.merge-pdf':'PDF\'leri birleştir',
      'desc.split-pdf':'Parçalara böl','desc.compress-pdf':'PDF boyutunu küçült',
      'desc.pdf-to-word':'Metin .doc dosyasına','desc.word-to-pdf':'DOCX → PDF',
      'desc.pdf-editor':'Metin ve nesneleri düzenle','desc.fill-sign':'Dijital imzalar',
      'desc.watermark':'Tüm sayfalara damga','desc.img-compress':'JPG, PNG, WEBP',
      'desc.ocr':'Resimden metin çıkar','desc.age-calc':'Kesin yaş, gerçek zamanlı',
      'desc.bmi-calc':'Metrik ve emperyal','desc.discount-calc':'Fiyat, % ve vergi',
      'desc.inheritance':'İslami miras','desc.pdf-to-ppt':'PDF\'den slaytlara',
      'desc.ppt-to-pdf':'PPTX → PDF','desc.pdf-to-excel':'Tabloları çıkar',
      'desc.excel-to-pdf':'XLSX → PDF','desc.html-to-pdf':'URL veya HTML\'den PDF',
      'desc.page-numbers':'Otomatik numaralama','desc.delete-pages':'Belirli sayfaları sil',
      'desc.ai-summarize':'Anında özet',
      'auth.signin.sub':'Çalışmanızı kaydetmek için giriş yapın.',
      'auth.no-account':'Hesabınız yok mu?','auth.signup.free':'Ücretsiz kaydolun',
      'auth.signup.title':'Hesabınızı oluşturun','auth.signup.sub':'Sonsuza kadar ücretsiz.',
      'auth.google.signup':'Google ile kaydol','auth.or.below':'veya aşağıyı doldurun',
      'auth.gender':'Cinsiyet','auth.gender.select':'— Cinsiyet seçin —','auth.gender.o':'Diğer',
      'auth.pw.min':'En az 8 karakter','auth.confirm-pw':'Şifre onayı',
      'auth.create-btn':'Hesap oluştur →','auth.have-account':'Zaten üye misiniz?','auth.go-signin':'Giriş Yap','auth.signup':'Kaydol',
      'btn.reset':'Sıfırla','btn.process':'İşle','btn.upload':'Dosya yükle',
      'btn.choose':'Dosya seç','btn.print':'Yazdır','btn.export':'Dışa aktar','btn.copy':'Kopyala',
      'upload.hint':'JPG, PNG, PDF desteklenir','notif.mark-read':'Hepsini okundu işaretle',
      'footer.brand':'CamMaster — en iyi ücretsiz belge tarayıcı.','footer.scanner':'Tarayıcı',
      'footer.pdf-tools':'PDF Araçları','footer.company':'Şirket',
      'section.how':'CamMaster ile belgeler nasıl taranır','section.why':'Neden CamMaster?',
      'toast.lang':'Dil değiştirildi','toast.theme.dark':'Karanlık mod','toast.theme.light':'Açık mod',
      'header.account':'Hesap','auth.or':'veya','auth.gmail':'Gmail / E-posta Adresi',
    },
  };
  Object.entries(_SUPPLEMENT).forEach(([lang, dict]) => {
    if (!TRANSLATIONS[lang]) TRANSLATIONS[lang] = {};
    Object.entries(dict).forEach(([key, val]) => {
      if (!TRANSLATIONS[lang][key]) TRANSLATIONS[lang][key] = val;
    });
  });

  /* ══════════════════════════════════════════════════════════════
     TRANSLATION ENGINE
  ══════════════════════════════════════════════════════════════ */

  let _currentLang = localStorage.getItem('cm_lang') || 'en';

  /**
   * Get a translation string for the given key in the current language.
   * Falls back to English if key is missing.
   */
  function t(key, lang) {
    const code = lang || _currentLang;
    const dict = TRANSLATIONS[code] || {};
    return dict[key] || TRANSLATIONS['en'][key] || key;
  }

  /**
   * Apply all [data-i18n] element translations to the DOM.
   * Supports:
   *   data-i18n="key"           → sets element.textContent
   *   data-i18n-placeholder="key" → sets element.placeholder
   *   data-i18n-title="key"    → sets element.title
   *   data-i18n-aria="key"     → sets element.ariaLabel
   */
  function applyTranslations(lang) {
    const code = lang || _currentLang;

    /* Text content */
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const val = t(key, code);
      if (val && val !== key) el.textContent = val;
    });

    /* Placeholders */
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const val = t(key, code);
      if (val && val !== key) el.placeholder = val;
    });

    /* Title attributes */
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      const val = t(key, code);
      if (val && val !== key) el.title = val;
    });

    /* aria-label attributes */
    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
      const key = el.getAttribute('data-i18n-aria');
      const val = t(key, code);
      if (val && val !== key) el.setAttribute('aria-label', val);
    });

    /* Programmatic translation of known structural elements */
    _translateStructural(code);
  }

  /* ── Structural reverse-lookup cache ──────────────────────── */
  var _structRevMap = null;

  function _buildStructRevMap() {
    _structRevMap = {};
    var en = TRANSLATIONS['en'];
    for (var k in en) {
      if (en.hasOwnProperty(k)) _structRevMap[en[k].trim()] = k;
    }
    /* Arrow-format tool names used in desktop nav dropdown (→ = →) */
    _structRevMap['Image → PDF'] = 'tool.img-to-pdf';
    _structRevMap['PDF → JPG'] = 'tool.pdf-to-jpg';
    _structRevMap['PDF → Word'] = 'tool.pdf-to-word';
    _structRevMap['Word → PDF'] = 'tool.word-to-pdf';
    _structRevMap['PDF → PowerPoint'] = 'tool.pdf-to-ppt';
    _structRevMap['PDF → Excel'] = 'tool.pdf-to-excel';
    _structRevMap['HTML → PDF'] = 'tool.html-to-pdf';
    _structRevMap['PowerPoint → PDF'] = 'tool.ppt-to-pdf';
    _structRevMap['Excel → PDF'] = 'tool.excel-to-pdf';
    /* Abbreviated/variant text appearing in nav */
    _structRevMap['Image Compressor'] = 'tool.img-compress';
    _structRevMap['Compress Image'] = 'tool.img-compress';
    _structRevMap['Discount Calc'] = 'tool.discount-calc';
    _structRevMap['About'] = 'nav.about';
  }

  function _resolveStructKey(text) {
    if (!_structRevMap) _buildStructRevMap();
    return _structRevMap[text.trim()] || null;
  }

  function _translateElStruct(el, code) {
    if (el.hasAttribute('data-i18n')) return;
    var key = el.getAttribute('data-i18n-s');
    if (!key) {
      key = _resolveStructKey(el.textContent);
      if (key) el.setAttribute('data-i18n-s', key);
    }
    if (key) {
      var val = t(key, code);
      if (val && val !== key) el.textContent = val;
    }
  }

  /**
   * Translate known structural elements via reverse-lookup when
   * they lack data-i18n attributes. Covers desktop nav items,
   * mega-dropdown headers/links, mobile drawer, auth modal,
   * upload box, and search input on ALL pages.
   */
  function _translateStructural(code) {
    /* ── ID-based element translations ── */
    var authLbl = _isSigned() ? t('header.account', code) : t('header.signin', code);
    var idMap = {
      'authLabel':     authLbl,
      'tabSignIn':     t('header.signin', code),
      'tabSignUp':     t('auth.signup', code),
      'authTitleTool': t('auth.signin.title', code),
    };
    for (var id in idMap) {
      if (idMap.hasOwnProperty(id)) {
        var el = document.getElementById(id);
        if (el && idMap[id]) el.textContent = idMap[id];
      }
    }

    /* ── Search placeholder ── */
    var searchInp = document.querySelector('.search-input');
    if (searchInp) searchInp.placeholder = t('header.search', code);

    /* ── Upload box ── */
    var upTxt = document.querySelector('.upload-text');
    if (upTxt) upTxt.textContent = t('upload.drop', code);
    var upHint = document.querySelector('.upload-hint');
    if (upHint) upHint.textContent = t('upload.hint', code);

    /* ══ Reverse-lookup navigation translation ══ */
    if (!_structRevMap) _buildStructRevMap();

    /* Top-level nav items: Home, Tools▾, Blog, Legal▾ */
    document.querySelectorAll('.nav-item').forEach(function(navEl) {
      if (navEl.hasAttribute('data-i18n')) return;
      if (navEl.classList.contains('has-dropdown')) {
        /* Dropdown trigger — modify first text node only, preserve chevron + dropdown */
        for (var i = 0; i < navEl.childNodes.length; i++) {
          var nd = navEl.childNodes[i];
          if (nd.nodeType === 3 && nd.textContent.trim()) {
            var k = nd._i18nKey;
            if (!k) { k = _resolveStructKey(nd.textContent); if (k) nd._i18nKey = k; }
            if (k) { var v = t(k, code); if (v && v !== k) nd.textContent = ' ' + v + ' '; }
            break;
          }
        }
      } else {
        _translateElStruct(navEl, code);
      }
    });

    /* Desktop mega-dropdown section headers (📄 PDF Converters, etc.) */
    document.querySelectorAll('.nd-section-head').forEach(function(el) { _translateElStruct(el, code); });

    /* Desktop mega-dropdown link names (Merge PDF, PDF Editor, etc.) */
    document.querySelectorAll('.nd-link-name').forEach(function(el) { _translateElStruct(el, code); });

    /* Mobile nav drawer section headers (PDF Tools, Edit & Sign, etc.) */
    document.querySelectorAll('.mnd-section').forEach(function(el) { _translateElStruct(el, code); });

    /* Mobile nav drawer links (Image to PDF, Smart Scan, etc.) */
    document.querySelectorAll('.mnd-link').forEach(function(el) { _translateElStruct(el, code); });

    /* ══ Auth modal deep translation ══ */
    _translateAuthPanel(code);
  }

  /**
   * Translate all text inside auth modal sign-in / sign-up panels.
   * Handles labels, buttons, selects, placeholders, switch-links.
   */
  function _translateAuthPanel(code) {
    /* ── Sign-In panel ── */
    var si = document.getElementById('panelSignIn');
    if (si) {
      var sH = si.querySelector('h2');
      if (sH) sH.textContent = t('auth.signin.title', code);
      var sP = si.querySelector('h2 + p');
      if (sP) sP.textContent = t('auth.signin.sub', code);
      var sG = si.querySelector('.google-btn');
      if (sG) sG.textContent = t('auth.google', code);
      var sD = si.querySelector('.auth-divider span');
      if (sD) sD.textContent = t('auth.or', code);
      var sLb = si.querySelectorAll('.auth-field label');
      if (sLb[0]) sLb[0].textContent = t('auth.email', code);
      if (sLb[1]) sLb[1].textContent = t('auth.password', code);
      var sSub = si.querySelector('.auth-submit');
      if (sSub) sSub.textContent = t('auth.btn.signin', code);
      var sSw = si.querySelector('.auth-switch');
      if (sSw) {
        var sA = sSw.querySelector('a');
        if (sA) sA.textContent = t('auth.signup.free', code);
        for (var i = 0; i < sSw.childNodes.length; i++) {
          if (sSw.childNodes[i].nodeType === 3 && sSw.childNodes[i].textContent.trim()) {
            sSw.childNodes[i].textContent = t('auth.no-account', code) + ' '; break;
          }
        }
      }
    }
    /* ── Sign-Up panel ── */
    var su = document.getElementById('panelSignUp');
    if (su) {
      var uH = su.querySelector('h2');
      if (uH) uH.textContent = t('auth.signup.title', code);
      var uP = su.querySelector('h2 + p');
      if (uP) uP.textContent = t('auth.signup.sub', code);
      var uG = su.querySelector('.google-btn');
      if (uG) uG.textContent = t('auth.google.signup', code);
      var uD = su.querySelector('.auth-divider span');
      if (uD) uD.textContent = t('auth.or.below', code);
      var uLb = su.querySelectorAll('.auth-field label');
      if (uLb[0]) uLb[0].textContent = t('auth.username', code);
      if (uLb[1]) uLb[1].textContent = t('auth.fullname', code);
      if (uLb[2]) uLb[2].textContent = t('auth.gender', code);
      if (uLb[3]) uLb[3].textContent = t('auth.gmail', code);
      if (uLb[4]) {
        /* Phone label has child .auth-field-opt span for "Optional" */
        for (var j = 0; j < uLb[4].childNodes.length; j++) {
          if (uLb[4].childNodes[j].nodeType === 3 && uLb[4].childNodes[j].textContent.trim()) {
            uLb[4].childNodes[j].textContent = t('auth.phone', code) + ' '; break;
          }
        }
        var optSp = uLb[4].querySelector('.auth-field-opt');
        if (optSp) optSp.textContent = t('auth.optional', code);
      }
      if (uLb[5]) uLb[5].textContent = t('auth.password', code);
      if (uLb[6]) uLb[6].textContent = t('auth.confirm-pw', code);
      /* Gender select options */
      var gSel = su.querySelector('select');
      if (gSel && gSel.options.length >= 4) {
        gSel.options[0].textContent = t('auth.gender.select', code);
        gSel.options[1].textContent = t('auth.gender.m', code);
        gSel.options[2].textContent = t('auth.gender.f', code);
        gSel.options[3].textContent = t('auth.gender.o', code);
      }
      /* Password min-length placeholder */
      var pwIn = document.getElementById('suPass');
      if (pwIn) pwIn.placeholder = t('auth.pw.min', code);
      var uSub = su.querySelector('.auth-submit');
      if (uSub) uSub.textContent = t('auth.create-btn', code);
      var uSw = su.querySelector('.auth-switch');
      if (uSw) {
        var uA = uSw.querySelector('a');
        if (uA) uA.textContent = t('auth.go-signin', code);
        for (var m = 0; m < uSw.childNodes.length; m++) {
          if (uSw.childNodes[m].nodeType === 3 && uSw.childNodes[m].textContent.trim()) {
            uSw.childNodes[m].textContent = t('auth.have-account', code) + ' '; break;
          }
        }
      }
    }
  }

  function _isSigned() {
    try { return !!JSON.parse(localStorage.getItem('cm_user')); } catch(e) { return false; }
  }

  /**
   * Set the active language, persist it, apply translations, handle RTL.
   */
  function setLanguage(code) {
    _currentLang = code;
    localStorage.setItem('cm_lang', code);

    const meta = LANG_META.find(l => l.code === code) || LANG_META[0];

    /* Apply RTL direction */
    document.documentElement.setAttribute('lang', code);
    if (meta.dir === 'rtl') {
      document.documentElement.setAttribute('dir', 'rtl');
    } else {
      document.documentElement.removeAttribute('dir');
    }

    /* Translate all data-i18n elements */
    applyTranslations(code);

    /* Update language button display */
    document.querySelectorAll('.lang-btn').forEach(btn => {
      const flagEl  = btn.querySelector('.lang-flag-current');
      const labelEl = btn.querySelector('.lang-label');
      if (flagEl)  flagEl.textContent  = meta.flag;
      if (labelEl) labelEl.textContent = code.toUpperCase();
    });

    /* Re-render language dropdowns */
    document.querySelectorAll('.lang-dropdown').forEach(drop => {
      _renderDropdown(drop);
    });

    /* Toast notification */
    if (typeof toast === 'function') {
      toast(`${meta.flag} ${meta.native} selected`, 'success');
    }
  }

  /**
   * Build the language dropdown HTML.
   */
  function _renderDropdown(drop) {
    drop.innerHTML = `<span class="lang-dropdown-header">🌐 Select Language</span>` +
      LANG_META.map(l => `
        <div class="lang-option${_currentLang === l.code ? ' active' : ''}" onclick="setLanguage('${l.code}')">
          <span class="lang-flag">${l.flag}</span>
          <div class="lang-opt-body">
            <div class="lang-opt-name">${l.name}</div>
            <div class="lang-opt-native">${l.native}</div>
          </div>
          ${_currentLang === l.code ? '<span class="lang-check">✓</span>' : ''}
        </div>`).join('');
  }

  /**
   * Initialize language selector — renders dropdowns and applies saved language.
   */
  function initLangSelector() {
    /* Update button display */
    const meta = LANG_META.find(l => l.code === _currentLang) || LANG_META[0];
    document.querySelectorAll('.lang-btn').forEach(btn => {
      const flagEl  = btn.querySelector('.lang-flag-current');
      const labelEl = btn.querySelector('.lang-label');
      if (flagEl)  flagEl.textContent  = meta.flag;
      if (labelEl) labelEl.textContent = _currentLang.toUpperCase();
    });

    /* Render all dropdowns */
    document.querySelectorAll('.lang-dropdown').forEach(drop => {
      _renderDropdown(drop);
    });

    /* Apply saved language direction + translations */
    if (_currentLang !== 'en') {
      if (meta.dir === 'rtl') {
        document.documentElement.setAttribute('dir', 'rtl');
      }
      document.documentElement.setAttribute('lang', _currentLang);
      applyTranslations(_currentLang);
    }
  }

  /* ── Public API ── */
  global.I18N = {
    t,
    setLanguage,
    applyTranslations,
    initLangSelector,
    getLang:    () => _currentLang,
    getMeta:    (code) => LANG_META.find(l => l.code === (code || _currentLang)),
    getAllLangs: () => LANG_META,
    getDict:    (code) => ({ ...TRANSLATIONS['en'], ...(TRANSLATIONS[code || _currentLang] || {}) }),
  };

  /* Also expose setLanguage globally for onclick handlers */
  global.setLanguage = setLanguage;

  /* Auto-init when DOM is ready */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLangSelector);
  } else {
    initLangSelector();
  }

})(window);
