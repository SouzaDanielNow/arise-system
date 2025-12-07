
import React from 'react';
import { X, CheckCircle, Shield, AlertTriangle, Loader } from 'lucide-react';

export type NotificationType = 'levelup' | 'info' | 'quest' | 'shield' | 'warning' | 'processing';

interface SystemNotificationProps {
  message: string;
  subMessage?: string;
  onClose: () => void;
  type?: NotificationType;
}

const SystemNotification: React.FC<SystemNotificationProps> = ({ message, subMessage, onClose, type = 'info' }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className={`bg-system-panel border-2 w-full max-w-md shadow-[0_0_30px_rgba(59,130,246,0.3)] animate-bounce-in relative overflow-hidden transition-colors duration-300
        ${type === 'warning' ? 'border-red-500/50 shadow-red-500/20' : 'border-system-blue/50'}
      `}>
        {/* Scanlines Effect */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] z-0 pointer-events-none bg-[length:100%_2px,3px_100%]"></div>
        
        <div className="relative z-10 p-6">
          <div className="flex justify-between items-start mb-4">
            <h3 className={`font-mono font-bold tracking-widest uppercase text-sm ${type === 'warning' ? 'text-red-500' : 'text-system-blue'}`}>
              System Notification
            </h3>
            {type !== 'processing' && (
              <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                <X size={20} />
              </button>
            )}
          </div>

          <div className="flex flex-col items-center text-center space-y-4">
             {type === 'levelup' && <CheckCircle size={48} className="text-yellow-400 animate-pulse" />}
             {type === 'quest' && <CheckCircle size={48} className="text-green-400 animate-pulse" />}
             {type === 'shield' && <Shield size={48} className="text-cyan-400 animate-pulse" />}
             {type === 'warning' && <AlertTriangle size={48} className="text-red-500 animate-pulse" />}
             {type === 'processing' && <Loader size={48} className="text-system-blue animate-spin" />}
             {type === 'info' && <div className="w-12 h-12 rounded-full border-2 border-system-blue flex items-center justify-center animate-pulse"><span className="text-2xl font-bold text-system-blue">i</span></div>}
             
             <h2 className="text-2xl font-bold text-white font-mono leading-tight">
               {message}
             </h2>
             
             {subMessage && (
               <p className="text-slate-300 font-sans text-sm border-t border-slate-700 pt-4 w-full">
                 {subMessage}
               </p>
             )}
          </div>

          {type !== 'processing' && (
            <button 
              onClick={onClose}
              className={`mt-6 w-full font-bold py-2 px-4 rounded font-mono transition-all duration-300 border active:scale-95
                ${type === 'warning' 
                  ? 'bg-red-500/20 hover:bg-red-500/40 border-red-500 text-red-500 hover:shadow-[0_0_15px_rgba(239,68,68,0.5)]' 
                  : 'bg-system-blue/20 hover:bg-system-blue/40 border-system-blue text-system-blue hover:shadow-[0_0_15px_rgba(59,130,246,0.5)]'}
              `}
            >
              ACKNOWLEDGE
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SystemNotification;
