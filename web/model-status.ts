import type { KiwiFailure } from './kiwi';

type MessageKey = 'loading' | 'failed' | 'retry' | 'wasm' | 'manifest' | 'manifest-format' | 'download' | 'size' | 'build' | 'worker' | 'unknown' | 'expected' | 'received' | 'bytes';
type Messages = Record<MessageKey, string>;

const messages: Record<string, Messages> = {
  zh: {loading:'正在加载韩语分析模型……',failed:'模型加载失败',retry:'请刷新页面重试。',wasm:'无法加载分析引擎',manifest:'无法加载模型清单', 'manifest-format':'模型清单格式无效',download:'模型文件下载失败',size:'模型文件大小不符',build:'模型初始化失败',worker:'分析线程出错',unknown:'未知错误',expected:'应为',received:'实际为',bytes:'字节'},
  ko: {loading:'한국어 분석 모델을 불러오는 중…',failed:'모델을 불러오지 못했습니다',retry:'페이지를 새로고침한 뒤 다시 시도하세요.',wasm:'분석 엔진을 불러오지 못했습니다',manifest:'모델 목록을 불러오지 못했습니다','manifest-format':'모델 목록 형식이 올바르지 않습니다',download:'모델 파일을 다운로드하지 못했습니다',size:'모델 파일 크기가 일치하지 않습니다',build:'모델을 초기화하지 못했습니다',worker:'분석 작업 스레드에서 오류가 발생했습니다',unknown:'알 수 없는 오류',expected:'예상',received:'실제',bytes:'바이트'},
  en: {loading:'Loading Korean analysis model…',failed:'Model failed to load',retry:'Please refresh the page and try again.',wasm:'Could not load the analysis engine',manifest:'Could not load the model manifest','manifest-format':'Invalid model manifest',download:'Could not download the model file',size:'Model file size mismatch',build:'Could not initialize the model',worker:'Analysis worker error',unknown:'Unknown error',expected:'expected',received:'received',bytes:'bytes'},
  ja: {loading:'韓国語解析モデルを読み込み中…',failed:'モデルを読み込めませんでした',retry:'ページを再読み込みしてお試しください。',wasm:'解析エンジンを読み込めませんでした',manifest:'モデル一覧を読み込めませんでした','manifest-format':'モデル一覧の形式が無効です',download:'モデルファイルをダウンロードできませんでした',size:'モデルファイルのサイズが一致しません',build:'モデルを初期化できませんでした',worker:'解析ワーカーでエラーが発生しました',unknown:'不明なエラー',expected:'想定',received:'実際',bytes:'バイト'},
  fr: {loading:'Chargement du modèle d’analyse du coréen…',failed:'Échec du chargement du modèle',retry:'Actualisez la page et réessayez.',wasm:'Impossible de charger le moteur d’analyse',manifest:'Impossible de charger le manifeste du modèle','manifest-format':'Manifeste du modèle invalide',download:'Échec du téléchargement du fichier du modèle',size:'Taille du fichier du modèle incorrecte',build:'Impossible d’initialiser le modèle',worker:'Erreur du processus d’analyse',unknown:'Erreur inconnue',expected:'attendu',received:'reçu',bytes:'octets'},
  es: {loading:'Cargando el modelo de análisis de coreano…',failed:'No se pudo cargar el modelo',retry:'Actualiza la página e inténtalo de nuevo.',wasm:'No se pudo cargar el motor de análisis',manifest:'No se pudo cargar el manifiesto del modelo','manifest-format':'El manifiesto del modelo no es válido',download:'No se pudo descargar el archivo del modelo',size:'El tamaño del archivo del modelo no coincide',build:'No se pudo inicializar el modelo',worker:'Error del proceso de análisis',unknown:'Error desconocido',expected:'esperado',received:'recibido',bytes:'bytes'},
  ru: {loading:'Загрузка модели анализа корейского языка…',failed:'Не удалось загрузить модель',retry:'Обновите страницу и попробуйте снова.',wasm:'Не удалось загрузить модуль анализа',manifest:'Не удалось загрузить список файлов модели','manifest-format':'Неверный формат списка файлов модели',download:'Не удалось скачать файл модели',size:'Размер файла модели не совпадает',build:'Не удалось инициализировать модель',worker:'Ошибка процесса анализа',unknown:'Неизвестная ошибка',expected:'ожидалось',received:'получено',bytes:'байт'},
  vi: {loading:'Đang tải mô hình phân tích tiếng Hàn…',failed:'Không thể tải mô hình',retry:'Vui lòng tải lại trang và thử lại.',wasm:'Không thể tải công cụ phân tích',manifest:'Không thể tải danh sách tệp mô hình','manifest-format':'Danh sách tệp mô hình không hợp lệ',download:'Không thể tải tệp mô hình',size:'Kích thước tệp mô hình không khớp',build:'Không thể khởi tạo mô hình',worker:'Lỗi tiến trình phân tích',unknown:'Lỗi không xác định',expected:'dự kiến',received:'nhận được',bytes:'byte'},
  mn: {loading:'Солонгос хэлний шинжилгээний загварыг ачаалж байна…',failed:'Загварыг ачаалж чадсангүй',retry:'Хуудсыг дахин ачаалж оролдоно уу.',wasm:'Шинжилгээний хөдөлгүүрийг ачаалж чадсангүй',manifest:'Загварын файлын жагсаалтыг ачаалж чадсангүй','manifest-format':'Загварын файлын жагсаалтын формат буруу байна',download:'Загварын файлыг татаж чадсангүй',size:'Загварын файлын хэмжээ таарахгүй байна',build:'Загварыг эхлүүлж чадсангүй',worker:'Шинжилгээний процессын алдаа',unknown:'Тодорхойгүй алдаа',expected:'хүлээгдсэн',received:'хүлээн авсан',bytes:'байт'},
  ar: {loading:'جارٍ تحميل نموذج تحليل اللغة الكورية…',failed:'تعذّر تحميل النموذج',retry:'يرجى تحديث الصفحة والمحاولة مرة أخرى.',wasm:'تعذّر تحميل محرّك التحليل',manifest:'تعذّر تحميل قائمة ملفات النموذج','manifest-format':'تنسيق قائمة ملفات النموذج غير صالح',download:'تعذّر تنزيل ملف النموذج',size:'حجم ملف النموذج غير مطابق',build:'تعذّرت تهيئة النموذج',worker:'خطأ في عملية التحليل',unknown:'خطأ غير معروف',expected:'المتوقع',received:'المستلم',bytes:'بايت'},
  th: {loading:'กำลังโหลดโมเดลวิเคราะห์ภาษาเกาหลี…',failed:'โหลดโมเดลไม่สำเร็จ',retry:'โปรดรีเฟรชหน้าแล้วลองอีกครั้ง',wasm:'โหลดเครื่องมือวิเคราะห์ไม่สำเร็จ',manifest:'โหลดรายการไฟล์โมเดลไม่สำเร็จ','manifest-format':'รูปแบบรายการไฟล์โมเดลไม่ถูกต้อง',download:'ดาวน์โหลดไฟล์โมเดลไม่สำเร็จ',size:'ขนาดไฟล์โมเดลไม่ตรงกัน',build:'เริ่มต้นโมเดลไม่สำเร็จ',worker:'เกิดข้อผิดพลาดในกระบวนการวิเคราะห์',unknown:'ข้อผิดพลาดที่ไม่ทราบสาเหตุ',expected:'ควรเป็น',received:'ได้รับ',bytes:'ไบต์'},
  id: {loading:'Memuat model analisis bahasa Korea…',failed:'Gagal memuat model',retry:'Segarkan halaman dan coba lagi.',wasm:'Gagal memuat mesin analisis',manifest:'Gagal memuat daftar berkas model','manifest-format':'Format daftar berkas model tidak valid',download:'Gagal mengunduh berkas model',size:'Ukuran berkas model tidak sesuai',build:'Gagal menginisialisasi model',worker:'Kesalahan pada proses analisis',unknown:'Kesalahan tidak diketahui',expected:'seharusnya',received:'diterima',bytes:'byte'}
};

export function modelLoadingText(language: string): string {
  return (messages[language] ?? messages.zh).loading;
}

export function modelFailureText(language: string, failure: KiwiFailure): string {
  const m = messages[language] ?? messages.zh;
  const reason = m[failure.code] ?? m.unknown;
  const file = failure.file ? `: ${failure.file}` : '';
  const status = failure.status !== undefined ? ` (HTTP ${failure.status})` : '';
  const size = failure.expected !== undefined && failure.actual !== undefined
    ? ` (${m.expected} ${failure.expected} ${m.bytes}, ${m.received} ${failure.actual} ${m.bytes})` : '';
  const detail = failure.detail ? ` (${failure.detail.slice(0, 160)})` : '';
  return `${m.failed}: ${reason}${file}${status}${size}${detail}. ${m.retry}`;
}
