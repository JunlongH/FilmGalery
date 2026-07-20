/**
 * 图标组件统一导出
 * 
 * 使用 Lucide React 图标库
 * 提供常用图标的快捷导入
 */

// 导航相关
export {
  Home,
  Calendar,
  Image,
  Film,
  Camera,
  FolderOpen,
  Heart,
  Star,
  Settings,
  Search,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ArrowLeft,
  ArrowRight,
  MoreHorizontal,
  MoreVertical,
} from 'lucide-react';

// 操作相关
export {
  Plus,
  Minus,
  Edit,
  Trash2,
  Download,
  Upload,
  Share2,
  Copy,
  Check,
  RefreshCw,
  Filter,
  SortAsc,
  SortDesc,
  Grid,
  List,
  Layers,
  ZoomIn,
  ZoomOut,
  Maximize,
  Minimize,
  RotateCw,
  RotateCcw,
} from 'lucide-react';

// 媒体相关
export {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Aperture,
  Sun,
  Moon,
} from 'lucide-react';

// 状态相关
export {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Info,
  HelpCircle,
  Loader2,
  Clock,
  Eye,
  EyeOff,
} from 'lucide-react';

// 文件相关
export {
  File,
  FileImage,
  Folder,
  FolderPlus,
  Save,
  FileText,
  Archive,
} from 'lucide-react';

// 社交相关
export {
  User,
  Users,
  UserPlus,
  MessageCircle,
  Send,
  Link,
  ExternalLink,
} from 'lucide-react';

// 位置相关
export {
  MapPin,
  Map,
  Navigation,
  Compass,
  Globe,
} from 'lucide-react';

// 时间相关
export {
  CalendarDays,
  CalendarRange,
  Timer,
  History,
} from 'lucide-react';

// 统计相关
export {
  BarChart2,
  PieChart,
  TrendingUp,
  TrendingDown,
  Activity,
} from 'lucide-react';

// 工具相关
export {
  Sliders,
  Wrench,
  Palette,
  Pipette,
  Crop,
  Move,
  Hand,
  Wand2,
} from 'lucide-react';

/**
 * 图标尺寸预设
 */
export const ICON_SIZES = {
  xs: 'w-3 h-3',
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-6 h-6',
  xl: 'w-8 h-8',
  '2xl': 'w-10 h-10',
};

/**
 * 创建带尺寸的图标组件
 * @param {React.ComponentType} Icon - Lucide 图标组件
 * @param {'xs'|'sm'|'md'|'lg'|'xl'|'2xl'} size - 图标尺寸
 * @returns {React.ReactElement}
 */
export function sizedIcon(Icon, size = 'md') {
  return <Icon className={ICON_SIZES[size]} />;
}
