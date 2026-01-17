import React from 'react';
import PropTypes from 'prop-types';
import Card from '../ui/Card';
import Select from '../ui/Select';
import SettingRow from './SettingRow';
import { CHAT_PERSONAS, DEFAULT_CHAT_PERSONA_ID } from '../../../shared/chatPersonas';

function ChatPersonaSection({ settings, setSettings }) {
  const currentValue = settings.chatPersona || DEFAULT_CHAT_PERSONA_ID;

  return (
    <Card className="p-5 border border-system-gray-200 shadow-sm space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-system-gray-500">
          Chat persona
        </p>
        <p className="text-sm text-system-gray-600">
          Choose the default tone and interaction style for chat responses.
        </p>
      </div>

      <SettingRow
        layout="col"
        label="Persona preset"
        description="Applies globally to chat responses"
      >
        <Select
          value={currentValue}
          onChange={(e) =>
            setSettings((prev) => ({
              ...prev,
              chatPersona: e.target.value
            }))
          }
          className="w-full"
        >
          {CHAT_PERSONAS.map((persona) => (
            <option key={persona.id} value={persona.id}>
              {persona.label}
            </option>
          ))}
        </Select>
        <p className="mt-2 text-xs text-system-gray-500">
          {CHAT_PERSONAS.find((persona) => persona.id === currentValue)?.description || ''}
        </p>
      </SettingRow>
    </Card>
  );
}

ChatPersonaSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired
};

export default ChatPersonaSection;
