import { OptionNames } from "@triliumnext/commons";
import FormText from "../../../react/FormText";
import { FormTextBoxWithUnit } from "../../../react/FormTextBox";
import OptionsSection from "./OptionsSection";
import { useTriliumOption } from "../../../react/hooks";
import { t } from "../../../../services/i18n";
import FormGroup from "../../../react/FormGroup";

interface AutoReadOnlySizeProps {
    label: string;
    option: OptionNames;
}

export default function AutoReadOnlySize({ label, option }: AutoReadOnlySizeProps) {
    const [ autoReadonlyOpt, setAutoReadonlyOpt ] = useTriliumOption(option);

    return (
        <OptionsSection title={t("text_auto_read_only_size.title")}>
            <FormText>{t("text_auto_read_only_size.description")}</FormText>

            <FormGroup name="auto-readonly-size-text" label={label}>
                <FormTextBoxWithUnit                    
                    type="number" min={0}
                    unit={t("text_auto_read_only_size.unit")}
                    currentValue={autoReadonlyOpt} onChange={setAutoReadonlyOpt}
                />
            </FormGroup>
        </OptionsSection>
    )
}