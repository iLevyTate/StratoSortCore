import React from 'react';
import PropTypes from 'prop-types';
import Select from '../ui/Select';
import SettingRow from './SettingRow';
import SettingsCard from './SettingsCard';
import { Text } from '../ui/Typography';
import { CHAT_PERSONAS, DEFAULT_CHAT_PERSONA_ID } from '../../../shared/chatPersonas';

function ChatPersonaSection({ settings, setSettings }) {
  const currentValue = settings.chatPersona || DEFAULT_CHAT_PERSONA_ID;

  return (
    <SettingsCard
      title="Chat persona"
      description="Choose the default tone and interaction style for chat responses."
    >
      <SettingRow
        layout="col"
        label="Persona Preset"
        description="Applies globally to chat responses."
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
        <Text variant="tiny" className="text-system-gray-500 mt-1">
          {CHAT_PERSONAS.find((persona) => persona.id === currentValue)?.description || ''}
        </Text>
      </SettingRow>
    </SettingsCard>
  );
}

ChatPersonaSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired
};

export default ChatPersonaSection;
